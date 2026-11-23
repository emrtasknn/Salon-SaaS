import { createHash, randomUUID } from "node:crypto";
import { escapeXml } from "./caldav-xml";

// ADR-045 phase C: an Apple configuration profile (.mobileconfig) with one CalDAV account
// payload, so the iPhone adds the RandevuN account in one step (Settings → Profile Downloaded).
// It carries the app-generated password; it is returned once and never stored.

export const MOBILECONFIG_TYPE = "application/x-apple-aspen-config";

/** A UUID-shaped id derived from a stable key, so the same member always gets the same one. */
function stableUuid(key: string, salt: string): string {
  const h = createHash("sha256").update(`${salt}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`.toUpperCase();
}

/**
 * `memberKey` identifies the member (not the account): reinstalling then carries the same
 * PayloadIdentifier, so iOS replaces the earlier RandevuN account instead of adding a second one
 * that is stuck on a revoked password. It is hashed and never appears in the profile.
 */
export function buildCalDavProfile(input: { host: string; username: string; password: string; salonName: string; memberKey?: string }): string {
  const principal = `https://${input.host}/dav/u/${encodeURIComponent(input.username)}/`;
  const accountUuid = input.memberKey ? stableUuid(input.memberKey, "caldav-account") : randomUUID().toUpperCase();
  const profileUuid = input.memberKey ? stableUuid(input.memberKey, "caldav-profile") : randomUUID().toUpperCase();
  const s = (value: string) => `<string>${escapeXml(value)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>CalDAVAccountDescription</key>${s("RandevuN")}
      <key>CalDAVHostName</key>${s(input.host)}
      <key>CalDAVPort</key><integer>443</integer>
      <key>CalDAVUseSSL</key><true/>
      <key>CalDAVPrincipalURL</key>${s(principal)}
      <key>CalDAVUsername</key>${s(input.username)}
      <key>CalDAVPassword</key>${s(input.password)}
      <key>PayloadDescription</key>${s("RandevuN randevu takvimi")}
      <key>PayloadDisplayName</key>${s("RandevuN takvimi")}
      <key>PayloadIdentifier</key>${s(`app.randevun.caldav.${accountUuid}`)}
      <key>PayloadType</key>${s("com.apple.caldav.account")}
      <key>PayloadUUID</key>${s(accountUuid)}
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>${s(`${input.salonName} randevuları iPhone Takvim'de; Takvim'de eklediğiniz etkinlikler uygulamada dolu saat olarak görünür.`)}
  <key>PayloadDisplayName</key>${s(`RandevuN — ${input.salonName}`)}
  <key>PayloadIdentifier</key>${s(`app.randevun.profile.${profileUuid}`)}
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key>${s("Configuration")}
  <key>PayloadUUID</key>${s(profileUuid)}
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;
}
