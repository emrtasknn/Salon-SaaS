import { describe, expect, it } from "vitest";

import { multistatus, requestedHrefs, requestedProps, requestedPropsQualified, requestedTimeRange, rootElement, selectProps } from "./caldav-xml";

describe("CalDAV request parsing", () => {
  it("reads the root and only top-level props (iOS PROPFIND shape)", () => {
    const body = `<?xml version="1.0"?><A:propfind xmlns:A="DAV:"><A:prop><A:getetag/><B:calendar-data xmlns:B="urn:ietf:params:xml:ns:caldav"><B:comp name="VEVENT"/></B:calendar-data><C:getctag xmlns:C="http://calendarserver.org/ns/"/></A:prop></A:propfind>`;
    expect(rootElement(body)).toBe("propfind");
    expect(requestedProps(body)).toEqual(["getetag", "calendar-data", "getctag"]);
  });
  it("reads multiget hrefs and query time ranges", () => {
    const body = `<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/></D:prop><D:href>/dav/u/x/cal/randevun/a-1.ics</D:href><D:href>/dav/u/x/cal/randevun/b.ics</D:href></C:calendar-multiget>`;
    expect(rootElement(body)).toBe("calendar-multiget");
    expect(requestedHrefs(body)).toEqual(["/dav/u/x/cal/randevun/a-1.ics", "/dav/u/x/cal/randevun/b.ics"]);
    const range = requestedTimeRange(`<C:time-range start="20261101T000000Z" end="20261201T000000Z"/>`);
    expect(range.start?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(range.end?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
  it("treats an empty body as allprop and builds an escaped multistatus", () => {
    expect(requestedProps("")).toEqual([]);
    expect(selectProps({ getetag: "1", displayname: "x" }, ["getetag", "nope"])).toEqual({ found: { getetag: "1" }, missing: ["nope"] });
    const xml = multistatus([{ href: "/dav/a&b", found: { getctag: "t" }, missing: ["owner"] }]);
    expect(xml).toContain("<D:href>/dav/a&amp;b</D:href>");
    expect(xml).toContain("<CS:getctag>t</CS:getctag>");
    expect(xml).toContain("<D:owner/>");
    expect(xml).toContain("HTTP/1.1 404 Not Found");
  });
});

describe("namespaces of asked properties (iOS declares xmlns inline)", () => {
  const ios = `<?xml version="1.0" encoding="UTF-8"?>
<A:propfind xmlns:A="DAV:"><A:prop><B:calendar-home-set xmlns:B="urn:ietf:params:xml:ns:caldav"/><B:calendar-user-address-set xmlns:B="urn:ietf:params:xml:ns:caldav"/><A:current-user-principal/><A:displayname/><C:dropbox-home-URL xmlns:C="http://calendarserver.org/ns/"/><C:email-address-set xmlns:C="http://calendarserver.org/ns/"/><C:notification-URL xmlns:C="http://calendarserver.org/ns/"/><A:principal-collection-set/><A:principal-URL/><A:resource-id/><B:schedule-inbox-URL xmlns:B="urn:ietf:params:xml:ns:caldav"/><B:schedule-outbox-URL xmlns:B="urn:ietf:params:xml:ns:caldav"/><A:supported-report-set/><X:custom xmlns:X="urn:example"/></A:prop></A:propfind>`;

  it("resolves each property's namespace", () => {
    const asked = requestedPropsQualified(ios);
    expect(asked.find((q) => q.name === "calendar-home-set")?.ns).toBe("urn:ietf:params:xml:ns:caldav");
    expect(asked.find((q) => q.name === "dropbox-home-URL")?.ns).toBe("http://calendarserver.org/ns/");
    expect(asked.find((q) => q.name === "resource-id")?.ns).toBe("DAV:");
    expect(asked.find((q) => q.name === "custom")?.ns).toBe("urn:example");
    expect(asked).toHaveLength(14);
  });

  it("answers missing properties in the namespace they were asked in", () => {
    const { found, missing } = selectProps({ "calendar-home-set": "<D:href>/h/</D:href>" }, requestedPropsQualified(ios));
    const xml = multistatus([{ href: "/p/", found, missing }]);
    expect(xml).toContain("<C:schedule-inbox-URL/>");
    expect(xml).toContain("<CS:dropbox-home-URL/>");
    expect(xml).toContain('<X:custom xmlns:X="urn:example"/>');
    expect(xml).toContain("<C:calendar-home-set><D:href>/h/</D:href></C:calendar-home-set>");
  });
});
