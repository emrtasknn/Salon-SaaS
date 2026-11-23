import { NextResponse, type NextRequest } from "next/server";

import { encryptSecret, verifyOAuthState } from "../../../../infrastructure/calendar-token-crypto";
import { createGoogleCalendarHttp } from "../../../../infrastructure/google-calendar-http";
import { logInfo } from "../../../../infrastructure/log-redaction";
import { getPrisma } from "../../../../infrastructure/prisma-runtime";
import { createPrismaCalendarSyncRepository } from "../../../../persistence/prisma-calendar-sync";
import { googleSyncConfig } from "../../../calendar-sync-runtime";
import { readSessionMember } from "../../../session-member";

export const dynamic = "force-dynamic";

const NONCE_COOKIE = "gcal_oauth_nonce";

/**
 * Google redirects here after consent. The state must verify (HMAC, expiry, cookie nonce) and
 * name the same tenant and profile as the current session; only then the code is exchanged,
 * the "RandevuN" calendar is created and the refresh token is stored encrypted.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const config = googleSyncConfig();
  const fallback = "/staff/settings/takvim";
  const back = (path: string, result: string) => {
    const response = NextResponse.redirect(new URL(`${path}?google=${result}`, url.origin));
    response.cookies.delete({ name: NONCE_COOKIE, path: "/api/google-calendar" });
    return response;
  };
  if (!config) return back(fallback, "unavailable");

  const state = verifyOAuthState(url.searchParams.get("state") ?? "", config.key, Date.now());
  if (!state) return back(fallback, "error");
  const nonce = request.cookies.get(NONCE_COOKIE)?.value;
  if (!nonce || nonce !== state.nonce) return back(state.returnTo, "error");
  if (url.searchParams.get("error")) return back(state.returnTo, "cancelled");
  const code = url.searchParams.get("code");
  if (!code) return back(state.returnTo, "error");

  const member = await readSessionMember();
  if (!member || member.tenantContext.tenantId !== state.tenantId || member.profileId !== state.profileId || (!member.isAdmin && !member.activeStaffId)) {
    return back(state.returnTo, "error");
  }

  const google = createGoogleCalendarHttp(config.oauth);
  try {
    const token = await google.exchangeCode(code, `${url.origin}/api/google-calendar/callback`);
    if (!token.refreshToken) return back(state.returnTo, "error");
    if (!token.scope.includes("calendar.app.created")) {
      await google.revoke(token.refreshToken);
      return back(state.returnTo, "scope");
    }
    const tenant = await member.prisma.tenant.findUnique({ where: { id: member.tenantContext.tenantId }, select: { name: true } });
    const calendarId = await google.createCalendar(token.accessToken, `RandevuN — ${tenant?.name ?? "Salon"}`);
    await createPrismaCalendarSyncRepository(getPrisma()).create(member.tenantContext, {
      profileId: member.profileId,
      refreshTokenEnc: encryptSecret(token.refreshToken, config.key),
      calendarId,
      accountEmail: token.email,
    });
    return back(state.returnTo, "connected");
  } catch (error) {
    logInfo("google_calendar_connect_failed", { code: (error as { code?: string }).code ?? "unknown" });
    return back(state.returnTo, "error");
  }
}
