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
});