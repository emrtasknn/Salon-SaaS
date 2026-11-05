import { describe, expect, it, vi } from "vitest";
import { createPrismaStaffAppointmentsRepository } from "./prisma-staff-appointments";
import type { PrismaTenantClient } from "./prisma-tenant-context";

describe("prisma staff appointments repository", () => {
  it("lists only the staff member's tenant appointments and maps display names", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const row = {
      id: "a1", tenantId: "t", staffId: "s1", serviceId: "svc1", customerProfileId: "p1", status: "PENDING",
      startAt: new Date("2026-11-05T09:00:00Z"), endAt: new Date("2026-11-05T09:30:00Z"),
      createdAt: new Date(), updatedAt: new Date(),
      contact: null,
      service: { name: "Saç kesimi" },
      customerProfile: { displayName: "Ayşe Y." },
    };
    const appointment = { findMany: vi.fn().mockResolvedValue([row]), findUnique: vi.fn() };
    const transaction = { $executeRaw: executeRaw, appointment, staff: { findUnique: vi.fn() } };
    const prisma = {
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction)),
    } as unknown as PrismaTenantClient;

    const range = { startAt: new Date("2026-11-05T00:00:00Z"), endAt: new Date("2026-11-06T00:00:00Z") };
    const result = await createPrismaStaffAppointmentsRepository(prisma).listForStaff({ tenantId: "t" as never }, "s1", range);

    expect(executeRaw).toHaveBeenCalled();
    expect(appointment.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t", staffId: "s1", startAt: { lt: range.endAt }, endAt: { gt: range.startAt } },
      orderBy: { startAt: "asc" },
      include: {
        contact: { select: { displayName: true, phone: true, email: true, whatsappOptIn: true, optOutAt: true } },
        service: { select: { name: true } },
        customerProfile: { select: { displayName: true } },
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "a1", serviceName: "Saç kesimi", customerName: "Ayşe Y.", bookingContact: null });
    // Relation objects do not leak past persistence.
    expect(result[0]).not.toHaveProperty("service");
    expect(result[0]).not.toHaveProperty("customerProfile");
    expect(result[0]).not.toHaveProperty("contact");
  });
});
