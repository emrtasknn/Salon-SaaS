import { describe, expect, it } from "vitest";

import { generatePassword, generateUsername, hashPassword, parseBasicAuth, verifyPassword } from "./caldav-credentials";
import { buildCalDavProfile } from "./caldav-profile";

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("CalDAV credentials", () => {
  it("makes usernames that carry the tenant slug and match the DB check", () => {
    const username = generateUsername("salon-a");
    expect(username).toMatch(/^[a-z0-9]{8}\.salon-a$/);
    expect(generatePassword()).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  });
  it("verifies only the right password against an scrypt hash", () => {
    const hash = hashPassword("abcd-efgh-ijkm-npqr");
    expect(hash).toMatch(/^scrypt\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(verifyPassword("abcd-efgh-ijkm-npqr", hash)).toBe(true);
    expect(verifyPassword("abcd-efgh-ijkm-npqx", hash)).toBe(false);
    expect(verifyPassword("x", "plain")).toBe(false);
  });
  it("parses Basic auth into slug, username and password", () => {
    expect(parseBasicAuth(basic("Abcd2345.salon-a", "p w"))).toEqual({ username: "abcd2345.salon-a", slug: "salon-a", password: "p w" });
    expect(parseBasicAuth(basic("nouser", "x"))).toBeNull();
    expect(parseBasicAuth(basic("abcd2345.salon-a", ""))).toBeNull();
    expect(parseBasicAuth("Bearer x")).toBeNull();
    expect(parseBasicAuth(null)).toBeNull();
  });
  it("builds an escaped configuration profile with the CalDAV payload", () => {
    const profile = buildCalDavProfile({ host: "app.example", username: "abcd2345.salon-a", password: "a<b", salonName: "A & B" });
    expect(profile).toContain("<string>com.apple.caldav.account</string>");
    expect(profile).toContain("<string>https://app.example/dav/u/abcd2345.salon-a/</string>");
    expect(profile).toContain("<string>a&lt;b</string>");
    expect(profile).toContain("A &amp; B");
  });
  it("keeps the same payload identity for the same member, so a reinstall replaces the old account", () => {
    const ids = (p: string) => [...p.matchAll(/<key>PayloadUUID<\/key><string>([^<]+)<\/string>/g)].map((m) => m[1]);
    const base = { host: "app.example", username: "abcd2345.salon-a", password: "x", salonName: "A" };
    const first = buildCalDavProfile({ ...base, memberKey: "t1:p1" });
    const again = buildCalDavProfile({ ...base, username: "zzzz9999.salon-a", memberKey: "t1:p1" });
    const other = buildCalDavProfile({ ...base, memberKey: "t1:p2" });
    expect(ids(first)).toHaveLength(2);
    expect(ids(again)).toEqual(ids(first));
    expect(ids(other)).not.toEqual(ids(first));
    expect(first).not.toContain("t1:p1");
  });
});
