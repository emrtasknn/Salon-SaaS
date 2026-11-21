import { describe, expect, it, vi } from "vitest";

import { createCalDavService, routeOf, type CalDavRepository, type StoredPhoneEvent } from "./caldav-service";
import { hashPassword } from "../domain/caldav-credentials";
import type { FeedHolder } from "./calendar-feed";

const USER = "abcd2345.salon-a";
const PASSWORD = "pass-word-1234-5678";
const HASH = hashPassword(PASSWORD);
const tenantContext = { tenantId: "t1" } as never;
const now = new Date("2026-11-20T12:00:00Z");
const auth = (user = USER, pass = PASSWORD) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
const appointment = {
  id: "ap1", startAt: new Date("2026-11-25T07:00:00Z"), endAt: new Date("2026-11-25T07:30:00Z"), status: "CONFIRMED",
  customerName: "Ayşe", serviceLabel: "Kesim", staffName: "Elif", updatedAt: now,
};
const phoneIcs = (uid = "P1") =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `UID:${uid}`, "DTSTART:20261126T080000Z", "DTEND:20261126T090000Z", "SUMMARY:Özel iş", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

function setup(holder: Partial<FeedHolder> = {}) {
  const events: StoredPhoneEvent[] = [];
  const repository: CalDavRepository = {
    findLiveAccount: vi.fn(async (_c, username) => (username === USER ? { id: "acc1", profileId: "p1", username: USER, passwordHash: HASH, lastSeenAt: null } : null)),
    touchAccount: vi.fn(async () => {}),
    readHolder: vi.fn(async () => ({ role: "STAFF" as const, staffId: "s1", staffActive: true, ...holder })),
    listAppointments: vi.fn(async () => [appointment]),
    listEvents: vi.fn(async () => [...events]),
    saveEvent: vi.fn(async (_c, input) => {
      const i = events.findIndex((e) => e.href === input.href);
      const row = { href: input.href, etag: input.etag, ics: input.ics, startAt: input.startAt, endAt: input.endAt };
      if (i >= 0) events[i] = row;
      else events.push(row);
    }),
    deleteEvent: vi.fn(async (_c, _a, href) => {
      const i = events.findIndex((e) => e.href === href);
      if (i < 0) return false;
      events.splice(i, 1);
      return true;
    }),
  };
  const hit = vi.fn(async () => "allowed" as const);
  const service = createCalDavService({
    repository,
    resolveTenantBySlug: async (slug) => (slug === "salon-a" ? { tenantContext, name: "Salon A", timezone: "Europe/Istanbul" } : null),
    hit,
    appUrl: () => "https://app.example/staff/calendar",
  });
  const call = (method: string, pathname: string, extra: Partial<Parameters<typeof service.handle>[0]> = {}) =>
    service.handle({ method, pathname, authorization: auth(), depth: null, ifMatch: null, ifNoneMatch: null, body: "", now, ...extra });
  return { repository, service, call, events, hit };
}

const CAL = `/dav/u/${USER}/cal/randevun/`;

describe("routing and auth", () => {
  it("routes the account tree only", () => {
    expect(routeOf("/dav/")).toEqual({ kind: "root" });
    expect(routeOf(`/dav/u/${USER}/cal/randevun/x.ics`)).toEqual({ kind: "item", user: USER, name: "x.ics" });
    expect(routeOf("/dav/u/x/other")).toBeNull();
    expect(routeOf("/elsewhere")).toBeNull();
  });

  it("redirects discovery and asks for Basic auth", async () => {
    const { call } = setup();
    expect((await call("GET", "/.well-known/caldav")).headers.Location).toBe("/dav/");
    const anon = await call("PROPFIND", "/dav/", { authorization: null });
    expect(anon.status).toBe(401);
    expect(anon.headers["WWW-Authenticate"]).toContain("Basic");
  });

  it("answers an iOS PROPFIND on the well-known path directly instead of redirecting", async () => {
    const { call } = setup();
    const res = await call("PROPFIND", "/.well-known/caldav", {
      body: "<A:propfind xmlns:A='DAV:'><A:prop><A:current-user-principal/><A:principal-URL/><A:resourcetype/></A:prop></A:propfind>",
      depth: "0",
    });
    expect(res.status).toBe(207);
    expect(res.body).toContain("<D:href>/.well-known/caldav</D:href>");
    expect(res.body).toContain(`<D:current-user-principal><D:href>/dav/u/${USER}/</D:href>`);
    expect((await call("PROPFIND", "/.well-known/caldav", { authorization: null })).status).toBe(401);
  });

  it("rejects a wrong password, another account's path and a deactivated staff member", async () => {
    const { call, hit } = setup();
    expect((await call("PROPFIND", "/dav/", { authorization: auth(USER, "wrong") })).status).toBe(401);
    expect(hit).toHaveBeenCalledWith("dav.miss");
    expect((await call("PROPFIND", "/dav/u/zzzz9999.salon-a/")).status).toBe(403);
    expect((await setup({ staffActive: false }).call("PROPFIND", "/dav/")).status).toBe(401);
  });
});

describe("discovery and reading (iOS flow)", () => {
  it("answers principal and home-set lookups", async () => {
    const { call } = setup();
    const root = await call("PROPFIND", "/dav/", { body: "<propfind xmlns='DAV:'><prop><current-user-principal/></prop></propfind>", depth: "0" });
    expect(root.status).toBe(207);
    expect(root.body).toContain(`<D:current-user-principal><D:href>/dav/u/${USER}/</D:href>`);
    const principal = await call("PROPFIND", `/dav/u/${USER}/`, { body: "<propfind xmlns='DAV:' xmlns:C='urn:ietf:params:xml:ns:caldav'><prop><C:calendar-home-set/></prop></propfind>", depth: "0" });
    expect(principal.body).toContain(`<C:calendar-home-set><D:href>/dav/u/${USER}/cal/</D:href>`);
    const home = await call("PROPFIND", `/dav/u/${USER}/cal/`, { body: "", depth: "1" });
    expect(home.body).toContain(`<D:href>${CAL}</D:href>`);
    expect(home.body).toContain("<C:calendar/>");
  });

  it("lists appointments (read-only) with etags and serves them by multiget and GET", async () => {
    const { call, repository } = setup();
    const list = await call("PROPFIND", CAL, { body: "<propfind xmlns='DAV:'><prop><getetag/></prop></propfind>", depth: "1" });
    expect(list.body).toContain(`${CAL}a-ap1.ics`);
    expect(repository.listAppointments).toHaveBeenCalledWith(tenantContext, expect.objectContaining({ staffId: "s1" }));
    const multiget = await call("REPORT", CAL, {
      body: `<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop><D:href>${CAL}a-ap1.ics</D:href><D:href>${CAL}gone.ics</D:href></C:calendar-multiget>`,
    });
    expect(multiget.body).toContain("SUMMARY:Ayşe — Kesim");
    expect(multiget.body).toContain(`<D:href>${CAL}gone.ics</D:href><D:status>HTTP/1.1 404 Not Found</D:status>`);
    const get = await call("GET", `${CAL}a-ap1.ics`);
    expect(get.status).toBe(200);
    expect(get.headers.ETag).toMatch(/^"/);
  });

  it("shows the whole salon with staff names to an admin", async () => {
    const { call, repository } = setup({ role: "TENANT_ADMIN", staffId: null, staffActive: false });
    const get = await call("GET", `${CAL}a-ap1.ics`);
    expect(repository.listAppointments).toHaveBeenCalledWith(tenantContext, expect.objectContaining({ staffId: null }));
    expect(get.body).toContain("(Elif)");
  });
});

describe("writing from the phone", () => {
  it("stores a new phone event as busy time for the staff member, then updates and deletes it", async () => {
    const { call, repository, events } = setup();
    const created = await call("PUT", `${CAL}P1.ics`, { body: phoneIcs(), ifNoneMatch: "*" });
    expect(created.status).toBe(201);
    expect(repository.saveEvent).toHaveBeenCalledWith(tenantContext, expect.objectContaining({ staffId: "s1", href: "P1.ics", title: "Özel iş", blocksTime: true }));
    expect((await call("PUT", `${CAL}P1.ics`, { body: phoneIcs(), ifNoneMatch: "*" })).status).toBe(412);
    expect((await call("PUT", `${CAL}P1.ics`, { body: phoneIcs(), ifMatch: '"stale"' })).status).toBe(412);
    expect((await call("PUT", `${CAL}P1.ics`, { body: phoneIcs(), ifMatch: events[0].etag })).status).toBe(204);
    // The collection's ctag changes, so the phone knows to re-sync.
    expect((await call("DELETE", `${CAL}P1.ics`)).status).toBe(204);
    expect((await call("DELETE", `${CAL}P1.ics`)).status).toBe(404);
  });

  it("never lets the phone change or delete an appointment, and rejects broken or huge bodies", async () => {
    const { call } = setup();
    expect((await call("PUT", `${CAL}a-ap1.ics`, { body: phoneIcs() })).status).toBe(403);
    expect((await call("DELETE", `${CAL}a-ap1.ics`)).status).toBe(403);
    expect((await call("PUT", `${CAL}x.ics`, { body: "nope" })).status).toBe(400);
    expect((await call("PUT", `${CAL}x.ics`, { body: "x".repeat(70_000) })).status).toBe(413);
  });
});
