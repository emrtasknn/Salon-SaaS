import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../domain/tenant-context";
import { applyWhatsAppWebhookStatuses, resolveWhatsAppTenantId } from "./prisma-whatsapp-webhook";

function fakePrisma() {
  const executeRaw = vi.fn().mockResolvedValue(1);
  const transaction = vi.fn(async (operation: (tx: { $executeRaw: typeof executeRaw }) => Promise<unknown>) => operation({ $executeRaw: executeRaw }));
  const queryRaw = vi.fn().mockResolvedValue([{ tenantId: "tenant-a" }]);
  return { $transaction: transaction, $queryRaw: queryRaw, executeRaw, transaction, queryRaw };
}

describe("WhatsApp webhook tenant routing", () => {
  it("resolves tenant only through the trusted routing function", async () => {
    const prisma = fakePrisma();
    await expect(resolveWhatsAppTenantId(prisma as never, "phone-a")).resolves.toBe("tenant-a");
    expect(prisma.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("updates delivery status inside the resolved tenant context", async () => {
    const prisma = fakePrisma();
    const tenantId = createTenantId("tenant-a");
    if (!tenantId.ok) throw new Error("test tenant id must be valid");
    const count = await applyWhatsAppWebhookStatuses(prisma as never, { tenantId: tenantId.value }, [
      { providerMessageId: "wamid.1", status: "delivered" },
    ]);
    expect(count).toBe(1);
    expect(prisma.transaction).toHaveBeenCalledTimes(1);
    expect(prisma.executeRaw).toHaveBeenCalledTimes(2);
  });

  it("does not mutate the domain for read events", async () => {
    const prisma = fakePrisma();
    const tenantId = createTenantId("tenant-a");
    if (!tenantId.ok) throw new Error("test tenant id must be valid");
    const count = await applyWhatsAppWebhookStatuses(prisma as never, { tenantId: tenantId.value }, [
      { providerMessageId: "wamid.1", status: "read" },
    ]);
    expect(count).toBe(0);
    expect(prisma.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("uses the sent status update only for pending deliveries", async () => {
    const prisma = fakePrisma();
    const tenantId = createTenantId("tenant-a");
    if (!tenantId.ok) throw new Error("test tenant id must be valid");

    const count = await applyWhatsAppWebhookStatuses(
      prisma as never,
      { tenantId: tenantId.value },
      [{ providerMessageId: "wamid.sent", status: "sent" }],
    );

    expect(count).toBe(1);
    expect(prisma.executeRaw).toHaveBeenCalledTimes(2);
    const statusQuery = prisma.executeRaw.mock.calls[1];
    expect(statusQuery[0].join("?")).toContain("status");
    expect(statusQuery[0].join("?")).toContain("'PENDING'");
    expect(statusQuery.slice(1)).toContain("tenant-a");
    expect(statusQuery.slice(1)).toContain("wamid.sent");
  });

  it("uses the failed status update and a default error code when none is supplied", async () => {
    const prisma = fakePrisma();
    const tenantId = createTenantId("tenant-a");
    if (!tenantId.ok) throw new Error("test tenant id must be valid");

    const count = await applyWhatsAppWebhookStatuses(
      prisma as never,
      { tenantId: tenantId.value },
      [{ providerMessageId: "wamid.failed", status: "failed" }],
    );

    expect(count).toBe(1);
    expect(prisma.executeRaw).toHaveBeenCalledTimes(2);
    const statusQuery = prisma.executeRaw.mock.calls[1];
    expect(statusQuery[0].join("?")).toContain("'FAILED'");
    expect(statusQuery.slice(1)).toContain("WHATSAPP_PROVIDER_FAILED");
    expect(statusQuery.slice(1)).toContain("tenant-a");
    expect(statusQuery.slice(1)).toContain("wamid.failed");
  });

  it("sums updated rows across multiple webhook status events", async () => {
    const prisma = fakePrisma();
    prisma.executeRaw
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    const tenantId = createTenantId("tenant-a");
    if (!tenantId.ok) throw new Error("test tenant id must be valid");

    const count = await applyWhatsAppWebhookStatuses(
      prisma as never,
      { tenantId: tenantId.value },
      [
        { providerMessageId: "wamid.sent", status: "sent" },
        { providerMessageId: "wamid.delivered", status: "delivered" },
      ],
    );

    expect(count).toBe(5);
    expect(prisma.executeRaw).toHaveBeenCalledTimes(3);
  });
});

  it("does not allow a failed webhook event to downgrade a delivered delivery", async () => {
    const prisma = fakePrisma();
    const tenantId = createTenantId("tenant-a");
    if (!tenantId.ok) throw new Error("test tenant id must be valid");

    await applyWhatsAppWebhookStatuses(
      prisma as never,
      { tenantId: tenantId.value },
      [{ providerMessageId: "wamid.late-failure", status: "failed" }],
    );

    const statusQuery = prisma.executeRaw.mock.calls[1];
    expect(statusQuery[0].join("?")).toContain("'PENDING', 'SENT'");
    expect(statusQuery.slice(1)).toContain("wamid.late-failure");
  });
