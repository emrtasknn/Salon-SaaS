import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClosureManagement } from "./closure-management";
import { createAuthenticatedIdentity } from "../domain/auth-identity";

const tenant = { tenantId: "t" as never };
const identity = createAuthenticatedIdentity("u", "admin-profile");
const now = new Date("2026-11-04T09:00:00.000Z");
const impactRow = { id: "a1", startAt: new Date("2026-11-09T07:30:00.000Z"), staffName: "Ali", customerName: "Ayse", status: "CONFIRMED" as const };
const impactView = { id: "a1", startLabel: "10:30", staffName: "Ali", customerName: "Ayse", status: "CONFIRMED" };

const repository = { list: vi.fn(), impact: vi.fn(), create: vi.fn(), delete: vi.fn() };
const authorizer = { authorizeAdmin: vi.fn() };
const management = () => createClosureManagement({ repository, authorizer, now: () => now });

beforeEach(() => {
  vi.clearAllMocks();
  authorizer.authorizeAdmin.mockResolvedValue(true);
  repository.list.mockResolvedValue({ timezone: "Europe/Istanbul", closures: [{ id: "c1", date: "2026-11-09", reason: null }] });
  repository.impact.mockResolvedValue({ timezone: "Europe/Istanbul", appointments: [impactRow] });
  repository.create.mockResolvedValue({ status: "created", closure: { id: "c1", date: "2026-11-09", reason: "Bayram" } });
  repository.delete.mockResolvedValue("deleted");
});

describe("closure management (WP-08)", () => {
  it("is TENANT_ADMIN-only for every operation", async () => {
    authorizer.authorizeAdmin.mockResolvedValue(false);
    await expect(management().list(identity, tenant, { from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual({ status: "FORBIDDEN" });
    await expect(management().previewImpact(identity, tenant, "2026-11-09")).resolves.toEqual({ status: "FORBIDDEN" });
    await expect(management().create(identity, tenant, { date: "2026-11-09", confirmExistingAppointments: false })).resolves.toEqual({ status: "FORBIDDEN" });
    await expect(management().delete(identity, tenant, "c1")).resolves.toEqual({ status: "FORBIDDEN" });
    authorizer.authorizeAdmin.mockResolvedValue(true);
    await expect(management().create({ state: "unauthenticated" }, tenant, { date: "2026-11-09", confirmExistingAppointments: false })).resolves.toEqual({ status: "FORBIDDEN" });
    for (const fn of Object.values(repository)) expect(fn).not.toHaveBeenCalled();
  });

  it("lists closures in a validated range", async () => {
    await expect(management().list(identity, tenant, { from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual({
      status: "OK", timezone: "Europe/Istanbul", closures: [{ id: "c1", date: "2026-11-09", reason: null }],
    });
    await expect(management().list(identity, tenant, { from: "2026-11-30", to: "2026-11-01" })).resolves.toEqual({ status: "INVALID_INPUT" });
  });

  it("previews impact with local start labels", async () => {
    await expect(management().previewImpact(identity, tenant, "2026-11-09")).resolves.toEqual({ status: "OK", appointments: [impactView] });
    await expect(management().previewImpact(identity, tenant, "2026-02-30")).resolves.toEqual({ status: "INVALID_INPUT" });
  });

  it("creates a tenant-wide closure with the caller as creator and a normalized reason", async () => {
    await expect(management().create(identity, tenant, { date: "2026-11-09", reason: "  Bayram ", confirmExistingAppointments: false }))
      .resolves.toEqual({ status: "CREATED", closure: { id: "c1", date: "2026-11-09", reason: "Bayram" } });
    expect(repository.create).toHaveBeenCalledWith(tenant, {
      date: "2026-11-09", reason: "Bayram", createdByProfileId: "admin-profile", confirmExistingAppointments: false, now,
    });
  });

  it("returns DUPLICATE for an existing tenant-wide closure", async () => {
    repository.create.mockResolvedValue("duplicate");
    await expect(management().create(identity, tenant, { date: "2026-11-09", confirmExistingAppointments: true })).resolves.toEqual({ status: "DUPLICATE" });
  });

  it("returns HAS_APPOINTMENTS when unconfirmed, and passes confirmation through (no auto-cancel)", async () => {
    repository.create.mockResolvedValueOnce({ status: "has_appointments", timezone: "Europe/Istanbul", appointments: [impactRow] });
    await expect(management().create(identity, tenant, { date: "2026-11-09", confirmExistingAppointments: false }))
      .resolves.toEqual({ status: "HAS_APPOINTMENTS", appointments: [impactView] });
    await expect(management().create(identity, tenant, { date: "2026-11-09", confirmExistingAppointments: true })).resolves.toMatchObject({ status: "CREATED" });
    expect(repository.create.mock.calls[1][1].confirmExistingAppointments).toBe(true);
  });

  it("maps PAST_DATE and rejects invalid input before persistence", async () => {
    repository.create.mockResolvedValueOnce("past_date");
    await expect(management().create(identity, tenant, { date: "2026-11-01", confirmExistingAppointments: false })).resolves.toEqual({ status: "PAST_DATE" });
    repository.create.mockClear();
    await expect(management().create(identity, tenant, { date: "2026-11-31", confirmExistingAppointments: false })).resolves.toEqual({ status: "INVALID_INPUT" });
    await expect(management().create(identity, tenant, { date: "2026-11-09", reason: "x".repeat(201), confirmExistingAppointments: false })).resolves.toEqual({ status: "INVALID_INPUT" });
    await expect(management().create(identity, tenant, { date: "2026-11-09", confirmExistingAppointments: "yes" })).resolves.toEqual({ status: "INVALID_INPUT" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("deletes by id, NOT_FOUND otherwise", async () => {
    await expect(management().delete(identity, tenant, "c1")).resolves.toEqual({ status: "DELETED" });
    repository.delete.mockResolvedValueOnce("not_found");
    await expect(management().delete(identity, tenant, "c2")).resolves.toEqual({ status: "NOT_FOUND" });
    await expect(management().delete(identity, tenant, "  ")).resolves.toEqual({ status: "NOT_FOUND" });
  });
});
