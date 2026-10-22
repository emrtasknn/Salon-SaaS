import { describe, expect, it, vi } from "vitest";
import { createPrismaCalendarCrmRepository } from "./prisma-calendar-crm";
import type { PrismaTenantClient } from "./prisma-tenant-context";

describe("prisma calendar crm repository", () => {
  it("scopes calendar queries by tenant and time and loads appointment names", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const appointment = { findMany: vi.fn().mockResolvedValue([]) };

    const transaction = {
      $executeRaw: executeRaw,
      tenantMembership: { findUnique: vi.fn() },
      appointment,
      profile: { findUnique: vi.fn() },
      customerNote: { findMany: vi.fn(), create: vi.fn() },
    };

    const prisma = {
      $transaction: vi.fn(
        async (callback: (value: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaTenantClient;

    await createPrismaCalendarCrmRepository(prisma).listAppointments(
      { tenantId: "t" as never },
      {
        startAt: new Date("2026-10-05T00:00:00Z"),
        endAt: new Date("2026-10-06T00:00:00Z"),
      },
    );

    expect(executeRaw).toHaveBeenCalled();

    expect(appointment.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "t",
        startAt: { lt: new Date("2026-10-06T00:00:00Z") },
        endAt: { gt: new Date("2026-10-05T00:00:00Z") },
      },
      orderBy: { startAt: "asc" },
      include: {
        staff: {
          include: {
            profile: { select: { displayName: true } },
          },
        },
        customerProfile: { select: { displayName: true } },
        service: { select: { name: true } },
      },
    });
  });

  it("loads tenant-scoped service and staff names for customer history", async () => {
    const startAt = new Date("2026-10-20T10:00:00Z");
    const endAt = new Date("2026-10-20T10:30:00Z");
    const appointmentRecord = {
      id: "appointment-a",
      tenantId: "tenant-a",
      staffId: "staff-a",
      serviceId: "service-a",
      customerProfileId: "customer-a",
      startAt,
      endAt,
      status: "CONFIRMED" as const,
      staff: { profile: { displayName: "Merve Yılmaz" } },
      service: { name: "Saç kesimi" },
    };
    const appointment = {
      findMany: vi.fn().mockResolvedValue([appointmentRecord]),
    };
    const profile = {
      findUnique: vi.fn().mockResolvedValue({
        id: "customer-a",
        displayName: "Ada",
        email: null,
        phone: null,
      }),
    };
    const customerNote = { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() };
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      tenantMembership: { findUnique: vi.fn() },
      appointment,
      profile,
      customerNote,
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (value: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaTenantClient;

    const result = await createPrismaCalendarCrmRepository(prisma).customerCard(
      { tenantId: "tenant-a" as never },
      "customer-a",
    );

    expect(result).toMatchObject({
      id: "customer-a",
      appointments: [
        {
          id: "appointment-a",
          tenantId: "tenant-a",
          staffId: "staff-a",
          serviceId: "service-a",
          customerProfileId: "customer-a",
          startAt,
          endAt,
          status: "CONFIRMED",
          staffDisplayName: "Merve Yılmaz",
          serviceName: "Saç kesimi",
        },
      ],
      notes: [],
    });
    expect(profile.findUnique).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-a", id: "customer-a" } },
    });
    expect(appointment.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", customerProfileId: "customer-a" },
      orderBy: { startAt: "desc" },
      include: {
        staff: { include: { profile: { select: { displayName: true } } } },
        service: { select: { name: true } },
      },
    });
    expect(customerNote.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", customerProfileId: "customer-a" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("does not query history or notes for a customer outside the tenant", async () => {
    const appointment = { findMany: vi.fn() };
    const profile = { findUnique: vi.fn().mockResolvedValue(null) };
    const customerNote = { findMany: vi.fn(), create: vi.fn() };
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      tenantMembership: { findUnique: vi.fn() },
      appointment,
      profile,
      customerNote,
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (value: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaTenantClient;

    const result = await createPrismaCalendarCrmRepository(prisma).customerCard(
      { tenantId: "tenant-a" as never },
      "customer-from-tenant-b",
    );

    expect(result).toBeNull();
    expect(profile.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_id: {
          tenantId: "tenant-a",
          id: "customer-from-tenant-b",
        },
      },
    });
    expect(appointment.findMany).not.toHaveBeenCalled();
    expect(customerNote.findMany).not.toHaveBeenCalled();
  });
});
