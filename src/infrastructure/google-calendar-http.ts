// ADR-045 phase B: minimal Google OAuth 2.0 + Calendar v3 client over fetch (no new dependency).
// Tokens are never logged; errors carry only an HTTP status / short code.

import { GOOGLE_CALENDAR_SCOPES, type GoogleEventBody, type Interval } from "../domain/google-calendar-sync";

export type GoogleOAuthConfig = Readonly<{ clientId: string; clientSecret: string }>;

export function readGoogleOAuthConfig(env: Readonly<Record<string, string | undefined>> = process.env): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export class GoogleApiError extends Error {
  constructor(readonly code: string, readonly httpStatus: number | null) {
    super(`google_api_${code}`);
    this.name = "GoogleApiError";
  }
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 10_000;

async function call<T>(fetchImpl: Fetch, url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new GoogleApiError("network", null);
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    let reason = `http_${response.status}`;
    try {
      const body = (await response.json()) as { error?: string | { status?: string } };
      if (typeof body.error === "string") reason = body.error; // e.g. invalid_grant
      else if (body.error?.status) reason = body.error.status.toLowerCase();
    } catch {
      // keep the HTTP code
    }
    throw new GoogleApiError(reason.slice(0, 60), response.status);
  }
  return (await response.json()) as T;
}

export function googleAuthorizeUrl(config: GoogleOAuthConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function createGoogleCalendarHttp(config: GoogleOAuthConfig, fetchImpl: Fetch = fetch) {
  const form = (values: Record<string, string>) => ({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  });
  const authed = (accessToken: string, init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const base = "https://www.googleapis.com/calendar/v3";

  return {
    async exchangeCode(code: string, redirectUri: string) {
      const token = await call<{ access_token: string; refresh_token?: string; id_token?: string; scope?: string }>(
        fetchImpl,
        "https://oauth2.googleapis.com/token",
        form({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      );
      return { accessToken: token.access_token, refreshToken: token.refresh_token ?? null, email: emailFromIdToken(token.id_token), scope: token.scope ?? "" };
    },

    async refreshAccessToken(refreshToken: string) {
      const token = await call<{ access_token: string }>(
        fetchImpl,
        "https://oauth2.googleapis.com/token",
        form({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" }),
      );
      return token.access_token;
    },

    async revoke(refreshToken: string) {
      await call<unknown>(fetchImpl, "https://oauth2.googleapis.com/revoke", form({ token: refreshToken })).catch(() => undefined);
    },

    async createCalendar(accessToken: string, summary: string) {
      const calendar = await call<{ id: string }>(fetchImpl, `${base}/calendars`, authed(accessToken, {
        method: "POST",
        body: JSON.stringify({ summary, timeZone: "Europe/Istanbul", description: "RandevuN uygulamasındaki randevular. Bu takvimi uygulama yönetir." }),
      }));
      return calendar.id;
    },

    async insertEvent(accessToken: string, calendarId: string, body: GoogleEventBody) {
      const event = await call<{ id: string }>(fetchImpl, `${base}/calendars/${encodeURIComponent(calendarId)}/events`, authed(accessToken, { method: "POST", body: JSON.stringify(body) }));
      return event.id;
    },

    async patchEvent(accessToken: string, calendarId: string, eventId: string, body: GoogleEventBody) {
      await call<unknown>(fetchImpl, `${base}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, authed(accessToken, { method: "PATCH", body: JSON.stringify(body) }));
    },

    async deleteEvent(accessToken: string, calendarId: string, eventId: string) {
      try {
        await call<unknown>(fetchImpl, `${base}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, authed(accessToken, { method: "DELETE" }));
      } catch (error) {
        // Already gone (user deleted it on the phone): nothing left to do.
        if (error instanceof GoogleApiError && (error.httpStatus === 404 || error.httpStatus === 410)) return;
        throw error;
      }
    },

    async freeBusy(accessToken: string, calendarIds: readonly string[], from: Date, to: Date): Promise<Interval[]> {
      if (calendarIds.length === 0) return [];
      const result = await call<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }> }>(
        fetchImpl,
        `${base}/freeBusy`,
        authed(accessToken, {
          method: "POST",
          body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: "UTC", items: calendarIds.map((id) => ({ id })) }),
        }),
      );
      const busy: Interval[] = [];
      for (const calendar of Object.values(result.calendars ?? {})) {
        for (const slot of calendar.busy ?? []) {
          const startAt = new Date(slot.start);
          const endAt = new Date(slot.end);
          if (!Number.isNaN(startAt.getTime()) && !Number.isNaN(endAt.getTime())) busy.push({ startAt, endAt });
        }
      }
      return busy;
    },
  };
}

export type GoogleCalendarHttp = ReturnType<typeof createGoogleCalendarHttp>;

/** Email claim of the id_token returned on the HTTPS token response (shown to the user only). */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.length <= 254 ? payload.email : null;
  } catch {
    return null;
  }
}
