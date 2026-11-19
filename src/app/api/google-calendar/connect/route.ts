import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { signOAuthState } from "../../../../infrastructure/calendar-token-crypto";
import { googleAuthorizeUrl } from "../../../../infrastructure/google-calendar-http";
import { googleSyncConfig } from "../../../calendar-sync-runtime";
import { readSessionMember } from "../../../session-member";

export const dynamic = "force-dynamic";

const STATE_TTL_MS = 10 * 60_000;
const OAUTH_NONCE_COOKIE = "gcal_oauth_nonce";

/**
 * ADR-045 phase B: starts "Google Takvim'i bağla". Only a signed-in admin or active staff member;
 * tenant and profile go into an HMAC-signed state bound to a one-time cookie nonce.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const area = url.searchParams.get("area") === "admin" ? "admin" : "staff";
  const returnTo = `/${area}/settings/takvim`;
  const config = googleSyncConfig();
  const member = config ? await readSessionMember() : null;
  if (!config || !member || (!member.isAdmin && !member.activeStaffId)) {
    return NextResponse.redirect(new URL(`${returnTo}?google=unavailable`, url.origin));
  }
  const nonce = randomBytes(16).toString("base64url");
  const state = signOAuthState(
    { tenantId: member.tenantContext.tenantId, profileId: member.profileId, nonce, expiresAt: Date.now() + STATE_TTL_MS, returnTo },
    config.key,
  );
  const response = NextResponse.redirect(googleAuthorizeUrl(config.oauth, `${url.origin}/api/google-calendar/callback`, state));
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/api/google-calendar", maxAge: STATE_TTL_MS / 1000 });
  return response;
}
