import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../domain/tenant-context";
import { createPrismaNotificationRepository } from "./prisma-notification";

function tenantContext(value: string) {
  const tenantId = createTenantId(value);
  if (!tenantId.ok) throw new Error(tenantId.error.message);
  return { tenantId: tenantId.value };
}

describe("Prisma notification repository", () => {
  it("does not reclaim a delivery that is already pending", async () => {
    const findUnique = vi.fn().mockResolvedValue({ status: "PENDING" });
    const create = vi.fn();
    const updateMany = vi.fn();
    const executeRaw = vi.fn().mockResolvedValue(1);

    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $executeRaw: executeRaw,
        notificationDelivery: { findUnique, create, updateMany },
      }),
    );

    const repository = createPrismaNotificationRepository({
      $transaction: transaction as never,
    });

    const result = await repository.claim(tenantContext("tenant-a"), {
      appointmentId: "appointment-1",
      eventType: "APPOINTMENT_CONFIRMED",
      channel: "WHATSAPP",
      recipientProfileId: "customer-1",
      templateKey: "appointment-confirmed-customer",
    });

    expect(result).toBe("already_pending");
    expect(findUnique).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledOnce();
  });

  it("does not reclaim an UNKNOWN delivery to prevent duplicate sends", async () => {
    const findUnique = vi.fn().mockResolvedValue({ status: "UNKNOWN" });
    const create = vi.fn();
    const updateMany = vi.fn();
    const executeRaw = vi.fn().mockResolvedValue(1);

    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $executeRaw: executeRaw,
        notificationDelivery: { findUnique, create, updateMany },
      }),
    );

    const repository = createPrismaNotificationRepository({
      $transaction: transaction as never,
    });

    const result = await repository.claim(tenantContext("tenant-a"), {
      appointmentId: "appointment-1",
      eventType: "APPOINTMENT_CONFIRMED",
      channel: "WHATSAPP",
      recipientProfileId: "customer-1",
      templateKey: "appointment-confirmed-customer",
    });

    expect(result).toBe("already_unknown");
    expect(findUnique).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledOnce();
  });
  it("reclaims a failed delivery for another attempt", async () => {
    const findUnique = vi.fn().mockResolvedValue({ status: "FAILED" });
    const create = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const executeRaw = vi.fn().mockResolvedValue(1);

    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $executeRaw: executeRaw,
        notificationDelivery: { findUnique, create, updateMany },
      }),
    );

    const repository = createPrismaNotificationRepository({
      $transaction: transaction as never,
    });

    const result = await repository.claim(tenantContext("tenant-a"), {
      appointmentId: "appointment-1",
      eventType: "APPOINTMENT_CONFIRMED",
      channel: "WHATSAPP",
      recipientProfileId: "customer-1",
      templateKey: "appointment-confirmed-customer",
    });

    expect(result).toBe("claimed");
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        appointmentId: "appointment-1",
        eventType: "APPOINTMENT_CONFIRMED",
        channel: "WHATSAPP",
        recipientProfileId: "customer-1",
      },
      data: { status: "PENDING" },
    });
  });

  describe("recipients()", () => {
    const appointmentRow = {
      startAt: new Date("2026-11-10T11:00:00.000Z"),
      customerProfile: { id: "customer-1", displayName: "Customer", phone: "+905550000002" },
      staff: { profile: { id: "staff-1", displayName: "Staff", phone: "+905550000001" } },
      service: { name: "Kesim" },
    };

    function adminMembership(profileId: string, phone: string | null) {
      return { profileId, profile: { id: profileId, displayName: `Admin ${profileId}`, phone } };
    }

    function setup(memberships: ReturnType<typeof adminMembership>[]) {
      const findMany = vi.fn().mockResolvedValue(memberships);
      const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
        operation({
          $executeRaw: vi.fn().mockResolvedValue(1),
          appointment: { findUnique: vi.fn().mockResolvedValue(appointmentRow) },
          tenant: { findUnique: vi.fn().mockResolvedValue({ timezone: "Europe/Istanbul" }) },
          tenantMembership: { findMany },
          notificationDelivery: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
        }),
      );
      const repository = createPrismaNotificationRepository({ $transaction: transaction as never });
      return { repository, findMany };
    }

    it("returns staff, customer, then tenant admins for APPOINTMENT_CREATED", async () => {
      const { repository } = setup([adminMembership("admin-1", "+905550000011"), adminMembership("admin-2", "+905550000012")]);
      const result = await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CREATED");
      expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1", "admin-1", "admin-2"]);
      expect(result.map((r) => r.templateKey)).toEqual([
        "appointment-created-staff",
        "appointment-created-customer",
        "appointment-created-staff",
        "appointment-created-staff",
      ]);
    });

    it("queries TENANT_ADMIN memberships with the tenant id from the tenant context", async () => {
      const { repository, findMany } = setup([]);
      await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CREATED");
      expect(findMany).toHaveBeenCalledOnce();
      expect(findMany).toHaveBeenCalledWith({
        where: { tenantId: "tenant-a", role: "TENANT_ADMIN" },
        include: { profile: true },
        orderBy: { profileId: "asc" },
      });
    });

    it("gives admins the staff template, body and parameters", async () => {
      const { repository } = setup([adminMembership("admin-1", "+905550000011")]);
      const result = await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CREATED");
      const staffEntry = result[0];
      const adminEntry = result[2];
      expect(adminEntry).toMatchObject({
        profileId: "admin-1",
        displayName: "Admin admin-1",
        phone: "+905550000011",
        templateKey: "appointment-created-staff",
        body: staffEntry.body,
      });
      expect(adminEntry.templateParameters).toEqual(staffEntry.templateParameters);
      expect(adminEntry.templateParameters[0]).toBe("Customer");
      expect(adminEntry.templateParameters[1]).toBe("Kesim");
    });

    it("omits admins with a null or blank phone", async () => {
      const { repository } = setup([
        adminMembership("admin-null", null),
        adminMembership("admin-blank", "  "),
        adminMembership("admin-ok", "+905550000011"),
      ]);
      const result = await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CREATED");
      expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1", "admin-ok"]);
    });

    it("dedupes admins by profile and internal phone but not by customer phone", async () => {
      const { repository } = setup([
        adminMembership("staff-1", "+905550000001"),
        adminMembership("customer-1", "+905550000002"),
        adminMembership("admin-a", "+90 555 000 00 01"),
        adminMembership("admin-b", "+90 555 000 00 11"),
        adminMembership("admin-c", "905550000011"),
        adminMembership("admin-d", "905550000002"),
      ]);
      const result = await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CREATED");
      expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1", "admin-b", "admin-d"]);
      expect(result[0].templateKey).toBe("appointment-created-staff");
      expect(result[1].templateKey).toBe("appointment-created-customer");
    });

    it.each(["APPOINTMENT_CONFIRMED", "APPOINTMENT_REJECTED"] as const)(
      "returns only the customer for %s without querying admins",
      async (eventType) => {
        const { repository, findMany } = setup([adminMembership("admin-1", "+905550000011")]);
        const result = await repository.recipients(tenantContext("tenant-a"), "appointment-1", eventType);
        expect(result.map((r) => r.profileId)).toEqual(["customer-1"]);
        expect(findMany).not.toHaveBeenCalled();
      },
    );
  });
});
