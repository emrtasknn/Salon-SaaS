import { describe, expect, it, vi } from "vitest";
import { createPrismaBookingRepository } from "./prisma-booking-engine";
import type { PrismaTenantClient } from "./prisma-tenant-context";
import { addDaysToDateIso, localWallTimeToUtc } from "../domain/availability";

function nextMondayIso(): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

const monday = nextMondayIso();
const nineAm = localWallTimeToUtc(monday, 9 * 60, "Europe/Istanbul");
const nineFifteen = localWallTimeToUtc(monday, 9 * 60 + 15, "Europe/Istanbul");

function makeTx(overrides: Readonly<{ tenantStatus?: string | null; closures?: string[]; profileMatch?: unknown; existingProfile?: unknown; conflicts?: unknown[] }> = {}) {
  const tenantStatus = overrides.tenantStatus !== undefined ? overrides.tenantStatus : "ACTIVE";
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue(tenantStatus === null ? [] : [{ status: tenantStatus }]),
    tenantMembership: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: "t", timezone: "Europe/Istanbul", status: "ACTIVE" }) },
    closureDate: { findMany: vi.fn().mockResolvedValue((overrides.closures ?? []).map((d) => ({ date: new Date(`${d}T00:00:00.000Z`) }))) },
    service: {
      findUnique: vi.fn().mockResolvedValue({ id: "svc", tenantId: "t", name: "Cut", durationMinutes: 60, bufferMinutes: 15, active: true }),
      findMany: vi.fn().mockResolvedValue([{ id: "svc", name: "Cut", durationMinutes: 60 }]),
    },
    staff: {
      findUnique: vi.fn().mockResolvedValue({ id: "s", tenantId: "t", profileId: "p", status: "ACTIVE" }),
      findMany: vi.fn().mockResolvedValue([{ id: "s2", profile: { displayName: "Zeynep" } }, { id: "s", profile: { displayName: "Ali" } }]),
    },
    workingHours: { findMany: vi.fn().mockResolvedValue([{ id: "wh", tenantId: "t", dayOfWeek: 1, openMinute: 540, closeMinute: 1080 }]) },
    profile: {
      findUnique: vi.fn().mockResolvedValue(overrides.existingProfile !== undefined ? overrides.existingProfile : { id: "c1", displayName: "C", email: null, phone: "+905551112233" }),
      findFirst: vi.fn().mockResolvedValue(overrides.profileMatch ?? null),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: "new-guest", displayName: data.displayName, email: data.email, phone: data.phone })),
    },
    appointment: { findMany: vi.fn().mockResolvedValue(overrides.conflicts ?? []), create: vi.fn().mockResolvedValue({ id: "a1" }), updateMany: vi.fn() },
    appointmentAccessToken: { create: vi.fn().mockResolvedValue({ id: "tok" }) },
  };
}

function prismaFor(tx: ReturnType<typeof makeTx>) {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
  vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
  return prisma;
}

const baseInput = {
  staffId: "s", serviceId: "svc", startAt: nineAm,
  customer: { kind: "guest" as const, displayName: "Guest", email: null, phone: "+905551112233" },
  initialStatus: "CONFIRMED" as const, accessTokenHash: "a".repeat(64),
};

describe("prisma booking repository", () => {
  it("serializes overlapping booking attempts for the same tenant and staff", async () => {
    const existingAppointment = {
      id: "existing", tenantId: "t", staffId: "s", serviceId: "svc", customerProfileId: "other",
      startAt: nineAm, endAt: new Date(nineAm.getTime() + 75 * 60_000), status: "PENDING" as const,
    };
    const tx = makeTx();
    tx.appointment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([existingAppointment]);
    const repository = createPrismaBookingRepository(prismaFor(tx));

    await expect(repository.createAppointment({ tenantId: "t" as never }, baseInput)).resolves.toMatchObject({ status: "created", appointmentId: "a1" });
    // The second start time overlaps the first appointment; it must use the same per-staff lock and reject the conflict.
    await expect(repository.createAppointment({ tenantId: "t" as never }, { ...baseInput, startAt: nineFifteen })).resolves.toBe("conflict");

    const lockKeys = tx.$executeRaw.mock.calls
      .filter((call) => String(call[0]).includes("pg_advisory_xact_lock"))
      .map((call) => call[1]);
    expect(lockKeys).toEqual(["t:s", "t:s"]);
    expect(tx.appointment.create).toHaveBeenCalledOnce();
  });

  it("returns tenant_inactive from the in-tx FOR SHARE read before closure/conflict reads or inserts (WP-07)", async () => {
    const tx = makeTx({ tenantStatus: "INACTIVE" });
    await expect(createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, baseInput)).resolves.toBe("tenant_inactive");
    expect(String((tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?"))).toMatch(/FROM "Tenant" WHERE "id" = \? FOR SHARE/);
    expect(tx.$queryRaw.mock.calls[0][1]).toBe("t");
    expect(tx.closureDate.findMany).not.toHaveBeenCalled();
    expect(tx.appointment.findMany).not.toHaveBeenCalled();
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });

  it("maps invalid transition without writing", async () => {
    const tx = { $executeRaw: vi.fn(), tenantMembership: { findUnique: vi.fn() }, appointment: { updateMany: vi.fn() } };
    const prisma = { $transaction: vi.fn() } as unknown as PrismaTenantClient;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => callback(tx as never));
    await expect(createPrismaBookingRepository(prisma).transition({ tenantId: "t" as never }, "a", "REJECTED", "CONFIRMED")).resolves.toBe("invalid_transition");
    expect(tx.appointment.updateMany).not.toHaveBeenCalled();
  });
});

describe("prisma booking repository create-on-behalf (WP-08)", () => {
  it("orders the tx: lock -> tenant FOR SHARE -> closure read -> service/staff -> conflict -> profile -> insert -> token", async () => {
    const tx = makeTx();
    await createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, baseInput);
    const lock = tx.$executeRaw.mock.invocationCallOrder[tx.$executeRaw.mock.calls.findIndex((c) => String(c[0]).includes("pg_advisory_xact_lock"))];
    const order = [
      lock,
      tx.$queryRaw.mock.invocationCallOrder[0],
      tx.closureDate.findMany.mock.invocationCallOrder[0],
      tx.service.findUnique.mock.invocationCallOrder[0],
      tx.appointment.findMany.mock.invocationCallOrder[0],
      tx.profile.create.mock.invocationCallOrder[0],
      tx.appointment.create.mock.invocationCallOrder[0],
      tx.appointmentAccessToken.create.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(tx.closureDate.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "t",
        date: { in: [new Date(`${monday}T00:00:00.000Z`), new Date(`${addDaysToDateIso(monday, 1)}T00:00:00.000Z`)] },
        OR: [{ staffId: null }, { staffId: "s" }],
      },
      select: { date: true },
    });
  });

  it("inserts with the requested initial status, in-tx endAt, and a token row", async () => {
    const tx = makeTx();
    await expect(createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, baseInput))
      .resolves.toEqual({ status: "created", appointmentId: "a1", customerPhone: "+905551112233" });
    const endAt = new Date(nineAm.getTime() + 75 * 60_000);
    expect(tx.appointment.create).toHaveBeenCalledWith({ data: {
      tenantId: "t", staffId: "s", serviceId: "svc", customerProfileId: "new-guest", startAt: nineAm, endAt, status: "CONFIRMED",
    } });
    expect(tx.appointmentAccessToken.create).toHaveBeenCalledWith({
      data: { tenantId: "t", appointmentId: "a1", tokenHash: "a".repeat(64), expiresAt: new Date(endAt.getTime() + 7 * 24 * 60 * 60_000) },
      select: { id: true },
    });
    expect(tx.profile.create).toHaveBeenCalledWith({ data: { tenantId: "t", displayName: "Guest", email: null, phone: "+905551112233" } });
    expect(tx.profile.findFirst).not.toHaveBeenCalled();
  });

  it("returns closed_date when the start date is closed, before conflict reads or inserts", async () => {
    const tx = makeTx({ closures: [monday] });
    await expect(createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, baseInput)).resolves.toBe("closed_date");
    expect(tx.appointment.findMany).not.toHaveBeenCalled();
    expect(tx.appointment.create).not.toHaveBeenCalled();
    expect(tx.appointmentAccessToken.create).not.toHaveBeenCalled();
  });

  it("re-checks working hours inside the transaction", async () => {
    const tx = makeTx();
    const late = localWallTimeToUtc(monday, 17 * 60 + 30, "Europe/Istanbul");
    await expect(createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, { ...baseInput, startAt: late })).resolves.toBe("slot_unavailable");
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });

  it("verifies an existing customer belongs to the tenant", async () => {
    const tx = makeTx({ existingProfile: null });
    await expect(createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, {
      ...baseInput, customer: { kind: "existing", profileId: "foreign" },
    })).resolves.toBe("customer_not_found");
    expect(tx.profile.findUnique).toHaveBeenCalledWith({ where: { tenantId_id: { tenantId: "t", id: "foreign" } } });
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });

  it("returns email_exists instead of silently attaching a guest to an existing profile", async () => {
    const tx = makeTx({ profileMatch: { id: "c9", displayName: "Known", email: "G@example.com", phone: null } });
    await expect(createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, {
      ...baseInput, customer: { kind: "guest", displayName: "Guest", email: "g@example.com", phone: null },
    })).resolves.toEqual({ status: "email_exists", existing: { profileId: "c9", displayName: "Known", phone: null, email: "G@example.com" } });
    expect(tx.profile.findFirst).toHaveBeenCalledWith({ where: { tenantId: "t", email: { equals: "g@example.com", mode: "insensitive" } } });
    expect(tx.profile.create).not.toHaveBeenCalled();
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });

  it("bounds getBookingContext appointments to the local day window and reads closures in the same tx", async () => {
    const tx = makeTx({ closures: [monday] });
    const context = await createPrismaBookingRepository(prismaFor(tx)).getBookingContext({ tenantId: "t" as never }, { serviceId: "svc", staffId: "s", dateIso: monday });
    expect(context).toMatchObject({ dateIso: monday, closedDates: [monday], tenantStatus: "ACTIVE", timezone: "Europe/Istanbul" });
    const where = tx.appointment.findMany.mock.calls[0][0].where;
    expect(where.endAt.gt).toEqual(localWallTimeToUtc(monday, 0, "Europe/Istanbul"));
    expect(where.startAt.lt).toEqual(localWallTimeToUtc(addDaysToDateIso(monday, 2), 0, "Europe/Istanbul"));
  });

  it("derives the context day from an instant in the tenant timezone", async () => {
    const tx = makeTx();
    const lateSunday = new Date(localWallTimeToUtc(monday, 0, "Europe/Istanbul").getTime() - 60_000);
    const context = await createPrismaBookingRepository(prismaFor(tx)).getBookingContext({ tenantId: "t" as never }, { serviceId: "svc", staffId: "s", at: lateSunday });
    expect(context?.dateIso).toBe(addDaysToDateIso(monday, -1));
  });

  it("create options: restricts to one staff member when given and sorts by name", async () => {
    const tx = makeTx();
    const options = await createPrismaBookingRepository(prismaFor(tx)).getCreateOptions({ tenantId: "t" as never }, { staffId: null });
    expect(options?.staff.map((s) => s.displayName)).toEqual(["Ali", "Zeynep"]);
    await createPrismaBookingRepository(prismaFor(tx)).getCreateOptions({ tenantId: "t" as never }, { staffId: "s" });
    expect(tx.staff.findMany.mock.calls[1][0].where).toEqual({ tenantId: "t", status: "ACTIVE", id: "s" });
  });
});

// QA (WP-08): in-transaction closure boundary + resource checks.
describe("prisma booking repository create-on-behalf QA additions (WP-08)", () => {
  const tuesday = addDaysToDateIso(monday, 1);
  function lateTx(closures: string[]) {
    const tx = makeTx({ closures });
    tx.workingHours.findMany.mockResolvedValue([{ id: "wh", tenantId: "t", dayOfWeek: 1, openMinute: 540, closeMinute: 1440 }]);
    return tx;
  }

  it("returns closed_date in-tx when only the buffer crosses midnight into a closed next date", async () => {
    const tx = lateTx([tuesday]);
    const startAt = localWallTimeToUtc(monday, 23 * 60, "Europe/Istanbul");
    await expect(createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, { ...baseInput, startAt })).resolves.toBe("closed_date");
    expect(tx.appointment.findMany).not.toHaveBeenCalled();
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });

  it("creates a slot ending exactly at local midnight before a closed date", async () => {
    const tx = lateTx([tuesday]);
    const startAt = localWallTimeToUtc(monday, 22 * 60 + 45, "Europe/Istanbul");
    await expect(createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, { ...baseInput, startAt }))
      .resolves.toMatchObject({ status: "created" });
  });

  it("rejects an INACTIVE staff row read inside the transaction", async () => {
    const tx = makeTx();
    tx.staff.findUnique.mockResolvedValue({ id: "s", tenantId: "t", profileId: "p", status: "INACTIVE" });
    await expect(createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, baseInput)).resolves.toBe("invalid_resource");
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });

  it("scopes every in-tx read and the insert to the context tenant id", async () => {
    const tx = makeTx();
    await createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, baseInput);
    expect(tx.closureDate.findMany.mock.calls[0][0].where.tenantId).toBe("t");
    expect(tx.staff.findUnique).toHaveBeenCalledWith({ where: { tenantId_id: { tenantId: "t", id: "s" } } });
    expect(tx.appointment.create.mock.calls[0][0].data.tenantId).toBe("t");
    expect(tx.appointmentAccessToken.create.mock.calls[0][0].data.tenantId).toBe("t");
  });

  it("maps a thrown error inside the transaction to persistence_failure", async () => {
    const tx = makeTx();
    tx.closureDate.findMany.mockRejectedValue(new Error("boom"));
    await expect(createPrismaBookingRepository(prismaFor(tx)).createAppointment({ tenantId: "t" as never }, baseInput)).resolves.toBe("persistence_failure");
    expect(tx.appointment.create).not.toHaveBeenCalled();
  });
});
