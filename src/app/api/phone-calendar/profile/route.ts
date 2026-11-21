import { buildCalDavProfile, MOBILECONFIG_TYPE } from "../../../../domain/caldav-profile";
import { issuePhoneCalendarAccount, phoneCalendarMember } from "../../../phone-calendar-runtime";

export const dynamic = "force-dynamic";

/**
 * ADR-045 phase C: "iPhone'a kur". A same-origin form POST issues a fresh RandevuN calendar
 * account for the signed-in member and answers with a configuration profile; iOS Safari then
 * offers to install it (Settings → Profile Downloaded). The password exists only in this response.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  // Session cookies are SameSite=Lax, and the Origin must be this app: no cross-site issuing.
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });
  const member = await phoneCalendarMember();
  if (!member) return new Response(null, { status: 401 });
  const issued = await issuePhoneCalendarAccount(member);
  if (!issued) return new Response(null, { status: 401 });
  const profile = buildCalDavProfile({ host: url.host, username: issued.username, password: issued.password, salonName: issued.salonName, memberKey: issued.memberKey });
  return new Response(profile, {
    status: 200,
    headers: {
      "Content-Type": MOBILECONFIG_TYPE,
      "Content-Disposition": 'attachment; filename="RandevuN.mobileconfig"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
