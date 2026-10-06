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
    expect(prisma.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not mutate the domain for read events", async () => {
    const prisma = fakePrisma();
    const tenantId = createTenantId("tenant-a");
    if (!tenantId.ok) throw new Error("test tenant id must be valid");
    const count = await applyWhatsAppWebhookStatuses(prisma as never, { tenantId: tenantId.value }, [
      { providerMessageId: "wamid.1", status: "read" },
    ]);
    expect(count).toBe(0);
    expect(prisma.executeRaw).not.toHaveBeenCalled();
  });
});
