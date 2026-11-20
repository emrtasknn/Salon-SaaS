import { describe, expect, it, vi } from "vitest";

import { createCalendarFeedService, holderMayUse, type CalendarFeedRepository, type FeedHolder } from "./calendar-feed";
import { generateCalendarFeedToken, hashCalendarFeedToken } from "../domain/calendar-feed";

const tenantContext = { tenantId: "tenant-1" } as never;
const now = new Date("2026-11-19T12:00:00Z");
const appointment = {
  id: "a1",
  startAt: new Date("2026-11-20T07:00:00Z"),
  endAt: new Date("2026-11-20T07:30:00Z"),
  status: "CONFIRMED",
  customerName: "Ayşe",
  serviceLabel: "Saç kesimi",
  staffName: "Elif",
  updatedAt: now,
};

function setup(options: { scope?: "STAFF_SELF" | "TENANT_ALL"; holder?: Partial<FeedHolder>; tenant?: boolean; limited?: boolean } = {}) {
  const { token, tokenHash } = generateCalendarFeedToken();
  const repository: CalendarFeedRepository = {
    replace: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
    status: vi.fn(async () => ({ active: true, createdAt: now, lastUsedAt: null })),
    findActiveByHash: vi.fn(async (_ctx, hash) => (hash === tokenHash ? { id: "tok-1", profileId: "p1", scope: options.scope ?? "STAFF_SELF", lastUsedAt: null } : null)),
    readHolder: vi.fn(async () => ({ role: "STAFF" as const, staffId: "s1", staffActive: true, ...options.holder })),
    listAppointments: vi.fn(async () => [appointment]),
    touch: vi.fn(async () => {}),
  };
  const hit = vi.fn(async () => (options.limited ? ("limited" as const) : ("allowed" as const)));
  const service = createCalendarFeedService({
    repository,
    resolveTenantBySlug: async (slug) => (options.tenant === false || slug !== "salon" ? null : { tenantContext, name: "Salon" }),
    hit,
    appUrl: () => "https://app.example/staff/calendar",
  });
  return { token, tokenHash, repository, hit, service };
}

describe("calendar feed service", () => {
  it("renders the staff member's own appointments without staff names", async () => {
    const { token, repository, service } = setup();
    const result = await service.render("salon", `${token}.ics`, now);
    expect(result.status).toBe("ok");
    expect(repository.listAppointments).toHaveBeenCalledWith(tenantContext, expect.objectContaining({ staffId: "s1" }));
    if (result.status === "ok") {
      expect(result.body).toContain("X-WR-CALNAME:Salon — Randevularım");
      expect(result.body).toContain("SUMMARY:Ayşe — Saç kesimi\r\n");
    }
    expect(repository.touch).toHaveBeenCalled();
  });

  it("renders every staff member's appointments for an admin's salon feed", async () => {
    const { token, repository, service } = setup({ scope: "TENANT_ALL", holder: { role: "TENANT_ADMIN", staffId: null, staffActive: false } });
    const result = await service.render("salon", token, now);
    expect(result.status).toBe("ok");
    expect(repository.listAppointments).toHaveBeenCalledWith(tenantContext, expect.objectContaining({ staffId: null }));
    if (result.status === "ok") expect(result.body).toContain("(Elif)");
  });

  it("returns 404 for a wrong slug, an unknown token or a malformed one", async () => {
    const { token, service } = setup();
    expect((await service.render("other", token, now)).status).toBe("NOT_FOUND");
    expect((await service.render("salon", generateCalendarFeedToken().token, now)).status).toBe("NOT_FOUND");
    expect((await service.render("salon", "../etc", now)).status).toBe("NOT_FOUND");
  });

  it("stops serving a deactivated staff member or a demoted admin", async () => {
    const inactive = setup({ holder: { staffActive: false } });
    expect((await inactive.service.render("salon", inactive.token, now)).status).toBe("NOT_FOUND");
    const demoted = setup({ scope: "TENANT_ALL", holder: { role: "STAFF" } });
    expect((await demoted.service.render("salon", demoted.token, now)).status).toBe("NOT_FOUND");
  });

  it("is rate limited", async () => {
    const { token, service } = setup({ limited: true });
    expect((await service.render("salon", token, now)).status).toBe("RATE_LIMITED");
  });

  it("issues a fresh token and stores only its hash", async () => {
    const { repository, service } = setup();
    const token = await service.issue(tenantContext, "p1", "STAFF_SELF", now);
    expect(repository.replace).toHaveBeenCalledWith(tenantContext, { profileId: "p1", scope: "STAFF_SELF", tokenHash: hashCalendarFeedToken(token), now });
  });
});

describe("holderMayUse", () => {
  it("requires an active staff row for the personal feed and an admin role for the salon feed", () => {
    expect(holderMayUse("STAFF_SELF", { role: "STAFF", staffId: "s", staffActive: true })).toBe(true);
    expect(holderMayUse("STAFF_SELF", { role: "TENANT_ADMIN", staffId: "s", staffActive: true })).toBe(true);
    expect(holderMayUse("STAFF_SELF", { role: "STAFF", staffId: null, staffActive: false })).toBe(false);
    expect(holderMayUse("STAFF_SELF", { role: "CUSTOMER", staffId: "s", staffActive: true })).toBe(false);
    expect(holderMayUse("TENANT_ALL", { role: "TENANT_ADMIN", staffId: null, staffActive: false })).toBe(true);
    expect(holderMayUse("TENANT_ALL", { role: null, staffId: null, staffActive: false })).toBe(false);
  });
});
