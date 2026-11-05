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
      customerProfile: { id: "customer-1", displayName: "Customer", phone: "+905559999999" },
      staff: { profile: { id: "staff-1", displayName: "Staff", phone: "+905550000001" } },
      service: { name: "Kesim" },
      // WP-10: customer WhatsApp uses only the booking contact snapshot with an active opt-in.
      contact: { phone: "+905550000002", whatsappOptIn: true, optOutAt: null as Date | null } as { phone: string | null; whatsappOptIn: boolean; optOutAt: Date | null } | null,
    };

    function adminMembership(profileId: string, phone: string | null) {
      return { profileId, profile: { id: profileId, displayName: `Admin ${profileId}`, phone } };
    }

    function setup(memberships: ReturnType<typeof adminMembership>[], row: typeof appointmentRow = appointmentRow) {
      const findMany = vi.fn().mockResolvedValue(memberships);
      const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
        operation({
          $executeRaw: vi.fn().mockResolvedValue(1),
          appointment: { findUnique: vi.fn().mockResolvedValue(row) },
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

    it("sends one WhatsApp to an admin who is also the appointment's staff (owner decision 2026-11-05)", async () => {
      const adminStaffRow = { ...appointmentRow, staff: { profile: { id: "admin-1", displayName: "Admin Staff", phone: "+905550000011" } } };
      const { repository } = setup([adminMembership("admin-1", "+905550000011"), adminMembership("admin-2", "+905550000012")], adminStaffRow);
      const result = await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CREATED");
      expect(result.map((r) => r.profileId)).toEqual(["admin-1", "customer-1", "admin-2"]);
      expect(result.filter((r) => r.profileId === "admin-1")).toHaveLength(1);
      expect(result[0].templateKey).toBe("appointment-created-staff");
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

    it("names the customer by the booking contact snapshot in staff/admin messages (WP-10 follow-up)", async () => {
      const contact = { ...appointmentRow.contact, displayName: "Ayşe (randevu)" } as unknown as typeof appointmentRow.contact;
      const { repository } = setup([adminMembership("admin-1", "+905550000011")], { ...appointmentRow, contact });
      const created = await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CREATED");
      const staffEntry = created.find((r) => r.profileId === "staff-1");
      const adminEntry = created.find((r) => r.profileId === "admin-1");
      expect(staffEntry?.templateParameters[0]).toBe("Ayşe (randevu)");
      expect(staffEntry?.body).toContain("Ayşe (randevu)");
      expect(adminEntry?.templateParameters[0]).toBe("Ayşe (randevu)");
      // Recipients and routing are unchanged: same profiles, customer still on the snapshot phone.
      expect(created.map((r) => r.profileId)).toEqual(["staff-1", "customer-1", "admin-1"]);
      expect(created.find((r) => r.profileId === "customer-1")?.phone).toBe("+905550000002");
    });

    it("sends the customer message to the contact-snapshot phone, never Profile.phone (WP-10)", async () => {
      const { repository } = setup([]);
      const created = await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CREATED");
      expect(created.find((r) => r.profileId === "customer-1")?.phone).toBe("+905550000002");
      const confirmed = await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CONFIRMED");
      expect(confirmed).toEqual([expect.objectContaining({ profileId: "customer-1", phone: "+905550000002" })]);
      expect(JSON.stringify([created, confirmed])).not.toContain("+905559999999");
    });

    it("routes a STAFF-recorded (verbal) opt-in exactly like a public-form opt-in: snapshot phone only (WP-10)", async () => {
      const staffContact = {
        source: "STAFF", phone: "+905550000077", whatsappOptIn: true, optOutAt: null, optInRecordedByProfileId: "staff-1",
      } as unknown as typeof appointmentRow.contact;
      const { repository } = setup([], { ...appointmentRow, contact: staffContact });
      const created = await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CREATED");
      expect(created.map((r) => [r.profileId, r.phone])).toEqual([["staff-1", "+905550000001"], ["customer-1", "+905550000077"]]);
      await expect(repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_REJECTED"))
        .resolves.toEqual([expect.objectContaining({ profileId: "customer-1", phone: "+905550000077", templateKey: "appointment-rejected-customer" })]);
    });

    it("STAFF-source opt-out also suppresses the customer (WP-10)", async () => {
      const staffContact = {
        source: "STAFF", phone: "+905550000077", whatsappOptIn: true, optOutAt: new Date("2026-11-10T09:00:00.000Z"),
      } as unknown as typeof appointmentRow.contact;
      const { repository } = setup([], { ...appointmentRow, contact: staffContact });
      await expect(repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CONFIRMED")).resolves.toEqual([]);
    });

    it.each([
      ["no contact row (pre-WP-10 booking)", null],
      ["opt-in with empty-string phone", { phone: "", whatsappOptIn: true, optOutAt: null }],
      ["no opt-in", { phone: "+905550000002", whatsappOptIn: false, optOutAt: null }],
      ["opted out", { phone: "+905550000002", whatsappOptIn: true, optOutAt: new Date("2026-11-10T09:00:00.000Z") }],
      ["opt-in without phone", { phone: null, whatsappOptIn: true, optOutAt: null }],
    ])("%s -> no customer recipient; staff/admin routing unchanged (WP-10)", async (_label, contact) => {
      const { repository } = setup([adminMembership("admin-1", "+905550000011")], { ...appointmentRow, contact });
      const created = await repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CREATED");
      expect(created.map((r) => r.profileId)).toEqual(["staff-1", "admin-1"]);
      await expect(repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_CONFIRMED")).resolves.toEqual([]);
      await expect(repository.recipients(tenantContext("tenant-a"), "appointment-1", "APPOINTMENT_REJECTED")).resolves.toEqual([]);
    });
  });
});
