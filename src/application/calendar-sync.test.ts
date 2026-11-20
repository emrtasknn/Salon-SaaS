import { describe, expect, it, vi } from "vitest";

import { createCalendarSync, type CalendarSyncRepository, type GooglePort, type StoredConnection } from "./calendar-sync";

const tenantContext = { tenantId: "t1" } as never;
const now = new Date("2026-11-19T12:00:00Z");
const connection: StoredConnection = {
  id: "c1", profileId: "p1", status: "ACTIVE", refreshTokenEnc: "enc", calendarId: "cal-1",
  busyCalendarIds: ["primary"], accountEmail: "a@example.com", lastSyncAt: null, lastErrorCode: null,
};
const appointment = {
  id: "a1", startAt: new Date("2026-11-20T07:00:00Z"), endAt: new Date("2026-11-20T07:30:00Z"), status: "CONFIRMED",
  customerName: "Ayşe", serviceLabel: "Kesim", staffName: "Elif", updatedAt: now,
};

function setup(overrides: { holder?: Partial<Awaited<ReturnType<CalendarSyncRepository["readHolder"]>>>; refresh?: () => Promise<string>; decrypt?: string | null } = {}) {
  const repository: CalendarSyncRepository = {
    findLive: vi.fn(async () => connection),
    findLiveForStaff: vi.fn(async () => connection),
    listStale: vi.fn(async () => [connection]),
    create: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
    markSynced: vi.fn(async () => {}),
    listLinks: vi.fn(async () => [{ appointmentId: "gone", externalEventId: "e-gone", syncedUpdatedAt: now }]),
    saveLink: vi.fn(async () => {}),
    deleteLink: vi.fn(async () => {}),
    replaceBusy: vi.fn(async () => {}),
    readHolder: vi.fn(async () => ({ role: "STAFF" as const, staffId: "s1", staffActive: true, ...overrides.holder })),
    listAppointments: vi.fn(async () => [appointment]),
  };
  const google: GooglePort = {
    refreshAccessToken: vi.fn(overrides.refresh ?? (async () => "access")),
    insertEvent: vi.fn(async () => "e-new"),
    patchEvent: vi.fn(async () => {}),
    deleteEvent: vi.fn(async () => {}),
    freeBusy: vi.fn(async () => [
      { startAt: new Date("2026-11-20T07:00:00Z"), endAt: new Date("2026-11-20T09:00:00Z") },
    ]),
  };
  const service = createCalendarSync({ repository, google, decrypt: () => ("decrypt" in overrides ? overrides.decrypt! : "refresh"), appUrl: null });
  return { repository, google, service };
}

describe("calendar sync", () => {
  it("writes new appointments, deletes gone ones and stores busy time minus own appointments", async () => {
    const { repository, google, service } = setup();
    const outcome = await service.sync(tenantContext, connection, now);
    expect(outcome).toMatchObject({ status: "synced", created: 1, removed: 1, busyBlocks: 1, failures: 0 });
    expect(google.insertEvent).toHaveBeenCalledWith("access", "cal-1", expect.objectContaining({ summary: "Ayşe — Kesim" }));
    expect(repository.saveLink).toHaveBeenCalledWith(tenantContext, "c1", { appointmentId: "a1", externalEventId: "e-new", syncedUpdatedAt: now });
    expect(google.deleteEvent).toHaveBeenCalledWith("access", "cal-1", "e-gone");
    expect(repository.listAppointments).toHaveBeenCalledWith(tenantContext, expect.objectContaining({ staffId: "s1" }));
    const busy = vi.mocked(repository.replaceBusy).mock.calls[0][1];
    expect(busy.staffId).toBe("s1");
    expect(busy.blocks.map((b) => [b.startAt.toISOString(), b.endAt.toISOString()])).toEqual([["2026-11-20T07:30:00.000Z", "2026-11-20T09:00:00.000Z"]]);
    expect(repository.markSynced).toHaveBeenCalledWith(tenantContext, "c1", { now, errorCode: null, status: "ACTIVE" });
  });

  it("mirrors the whole salon for an admin who does not serve, without busy blocks", async () => {
    const { repository, google, service } = setup({ holder: { role: "TENANT_ADMIN", staffId: null, staffActive: false } });
    await service.sync(tenantContext, connection, now);
    expect(repository.listAppointments).toHaveBeenCalledWith(tenantContext, expect.objectContaining({ staffId: null }));
    expect(google.freeBusy).not.toHaveBeenCalled();
    expect(google.insertEvent).toHaveBeenCalledWith("access", "cal-1", expect.objectContaining({ summary: "Ayşe — Kesim (Elif)" }));
  });

  it("revokes the connection of a deactivated staff member", async () => {
    const { repository, google, service } = setup({ holder: { staffActive: false } });
    expect(await service.sync(tenantContext, connection, now)).toEqual({ status: "revoked", code: "holder_inactive" });
    expect(repository.revoke).toHaveBeenCalledWith(tenantContext, "c1", now);
    expect(google.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("stops for good when Google says invalid_grant, and keeps trying on other errors", async () => {
    const revoked = setup({ refresh: async () => { throw Object.assign(new Error("x"), { code: "invalid_grant" }); } });
    expect(await revoked.service.sync(tenantContext, connection, now)).toEqual({ status: "revoked", code: "invalid_grant" });
    expect(revoked.repository.markSynced).toHaveBeenCalledWith(tenantContext, "c1", { now, errorCode: "invalid_grant", status: "REVOKED" });
    const flaky = setup({ refresh: async () => { throw Object.assign(new Error("x"), { code: "network" }); } });
    expect(await flaky.service.sync(tenantContext, connection, now)).toEqual({ status: "error", code: "network" });
  });

  it("marks an unreadable token (key changed) as an error without calling Google", async () => {
    const { google, service } = setup({ decrypt: null });
    expect(await service.sync(tenantContext, connection, now)).toEqual({ status: "error", code: "token_unreadable" });
    expect(google.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("records a partial sync when one write fails", async () => {
    const { repository, google, service } = setup();
    vi.mocked(google.insertEvent).mockRejectedValueOnce(new Error("boom"));
    expect(await service.sync(tenantContext, connection, now)).toMatchObject({ status: "synced", failures: 1 });
    expect(repository.markSynced).toHaveBeenCalledWith(tenantContext, "c1", { now, errorCode: "partial", status: "ACTIVE" });
  });
});
