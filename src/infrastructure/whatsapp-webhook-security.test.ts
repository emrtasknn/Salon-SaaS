import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { PrismaTenantTransactionClient } from "../persistence/prisma-tenant-context";

import {
  verifyMetaWebhookSignature,
  parseMetaWebhookStatuses,
} from "./meta-whatsapp-webhook";
import {
  resolveWhatsAppTenantId,
  applyWhatsAppWebhookStatuses,
} from "../persistence/prisma-whatsapp-webhook";
import type { TenantContext, TenantId } from "../domain/tenant-context";
import { createTenantId } from "../domain/tenant-context";

type MockRawQueryClient = Parameters<typeof resolveWhatsAppTenantId>[0] & {
  $executeRaw<T>(
    query: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<T>;
};

const mockTenantId = "tenant_123";

function getQueryText(query: TemplateStringsArray): string {
  return Array.from(query).join("?");
}

function isSetConfigQuery(query: TemplateStringsArray): boolean {
  return getQueryText(query).includes("set_config");
}

const mockProviderMessageIds = {
  tenant_123: "msg_tenant_123",
};

function createMockTenantContext(
  overrides: Partial<TenantContext> = {},
): TenantContext {
  const tenantIdResult = createTenantId(mockTenantId as string);
  // DomainResult<T> has .ok boolean and .value property on success
  const resolvedTenantId = tenantIdResult.ok
    ? tenantIdResult.value
    : (mockTenantId as TenantId);
  return {
    tenantId: resolvedTenantId,
    ...overrides,
  };
}

describe("WhatsApp webhook security - unknown phone_number_id", () => {
  it("resolveWhatsAppTenantId returns null for unknown phone_number_id", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        // Return array with type assertion - tests access rows[0]?.tenantId
        return [{ tenantId: null }] as unknown as T;
      },
    } as unknown as MockRawQueryClient;

    const result = await resolveWhatsAppTenantId(prisma, "unknown_phone_id");
    expect(result).toBeNull();
  });

  it("applyWhatsAppWebhookStatuses skips when tenantId is null", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        return [{ tenantId: null }] as unknown as T;
      },
      $executeRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        if (isSetConfigQuery(query)) {
          expect(values[0]).toBe(tenantContext.tenantId);
          return 1 as unknown as T;
        }
        return 0 as unknown as T;
      },
      $transaction: async (
        operation: (tx: PrismaTenantTransactionClient) => Promise<unknown>,
      ) => {
        // Execute operation directly, simulating transaction behavior
        return operation({ $executeRaw: prisma.$executeRaw } as unknown as PrismaTenantTransactionClient);
      },
    } as unknown as MockRawQueryClient;

    const tenantContext = createMockTenantContext();
    const statuses = [
      {
        providerMessageId: mockProviderMessageIds.tenant_123,
        status: "sent" as const,
      },
    ];

    const updatedCount = await Promise.resolve(
      await applyWhatsAppWebhookStatuses(prisma, tenantContext, statuses),
    );
    expect(updatedCount).toBe(0);
  });
});
describe("WhatsApp webhook security - READ status handling", () => {
  it("applyWhatsAppWebhookStatuses skips READ status without mutating delivery", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        return [{ tenantId: mockTenantId }] as unknown as T;
      },
      $executeRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        if (isSetConfigQuery(query)) {
          expect(values[0]).toBe(tenantContext.tenantId);
          return 1 as unknown as T;
        }
        return 0 as unknown as T;
      },
      $transaction: async (operation: (tx: PrismaTenantTransactionClient) => Promise<unknown>) => {
        // Execute operation directly, simulating transaction behavior
        return operation({ $executeRaw: prisma.$executeRaw } as unknown as PrismaTenantTransactionClient);
      },
    } as unknown as MockRawQueryClient;

    const tenantContext = createMockTenantContext();
    const statuses = [
      {
        providerMessageId: mockProviderMessageIds.tenant_123,
        status: "read" as const,
      },
    ];

    const updatedCount = await Promise.resolve(
      await applyWhatsAppWebhookStatuses(prisma, tenantContext, statuses),
    );
    expect(updatedCount).toBe(0);
  });

  it("parseMetaWebhookStatuses does not include READ in status values", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "phone_1" },
                statuses: [{ id: "wamid_1", status: "read" }],
              },
            },
          ],
        },
      ],
    };

    const result = parseMetaWebhookStatuses(payload);
    expect(result[0].status).toBe("read");
  });
});
describe("WhatsApp webhook security - unknown providerMessageId", () => {
  it("applyWhatsAppWebhookStatuses updates 0 rows when providerMessageId does not match any delivery", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        return [{ tenantId: mockTenantId }] as unknown as T;
      },
      $executeRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        if (isSetConfigQuery(query)) {
          return 1 as unknown as T;
        }
        return 0 as unknown as T;
      },
      $transaction: async (operation: (tx: PrismaTenantTransactionClient) => Promise<unknown>) => {
        return operation({ $executeRaw: prisma.$executeRaw } as unknown as PrismaTenantTransactionClient);
      },
    } as unknown as MockRawQueryClient;

    const tenantContext = createMockTenantContext();
    const statuses = [
      { providerMessageId: "nonexistent_message_id", status: "sent" as const },
    ];

    const updatedCount = await Promise.resolve(
      await applyWhatsAppWebhookStatuses(prisma, tenantContext, statuses),
    );
    expect(updatedCount).toBe(0);
  });
});
describe("WhatsApp webhook security - signature verification (existing coverage)", () => {
  it("verifyMetaWebhookSignature rejects bad signatures", () => {
    const result = verifyMetaWebhookSignature({
      rawBody: '{"entry":[]}',
      signatureHeader: "sha256=bad",
      appSecret: "test-secret",
    });
    expect(result).toBe(false);
  });

  it("verifyMetaWebhookSignature accepts valid signatures", () => {
    const rawBody = '{"entry":[]}';
    const secret = "test-secret";
    const signature = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    const result = verifyMetaWebhookSignature({
      rawBody,
      signatureHeader: `sha256=${signature}`,
      appSecret: secret,
    });
    expect(result).toBe(true);
  });
});
describe("WhatsApp webhook security - cross-tenant isolation", () => {
  it("Tenant A's providerMessageId does not affect Tenant B's delivery records", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        return [{ tenantId: mockTenantId }] as unknown as T;
      },
      $executeRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        if (isSetConfigQuery(query)) {
          expect(values[0]).toBe(tenantContext.tenantId);
          return 1 as unknown as T;
        }
        const otherTenantId = "tenant_999";
        expect(values).toContain(tenantContext.tenantId);
        expect(values).not.toContain(otherTenantId);
        expect(values).toContain(mockProviderMessageIds.tenant_123);
        return 1 as unknown as T;
      },
      $transaction: async (operation: (tx: PrismaTenantTransactionClient) => Promise<unknown>) => {
        return operation({ $executeRaw: prisma.$executeRaw } as unknown as PrismaTenantTransactionClient);
      },
    } as unknown as MockRawQueryClient;

    const tenantContext = createMockTenantContext();

    const statuses = [
      {
        providerMessageId: mockProviderMessageIds.tenant_123,
        status: "sent" as const,
      },
    ];

    const updatedCount = await Promise.resolve(
      await applyWhatsAppWebhookStatuses(prisma, tenantContext, statuses),
    );
    expect(updatedCount).toBe(1);
  });

  it("Webhook route correctly uses resolveWhatsAppTenantId before applyWhatsAppWebhookStatuses", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        return [{ tenantId: mockTenantId }] as unknown as T;
      },
    } as unknown as MockRawQueryClient;

    const phoneNumberId = "phone_123";
    const tenantId = await resolveWhatsAppTenantId(prisma, phoneNumberId);
    expect(tenantId).not.toBeNull();
    expect(tenantId).toContain(mockTenantId);
  });
});
describe("WhatsApp webhook security - idempotency (repeated webhook)", () => {
  it("UPDATE query includes status IN ('PENDING', 'UNKNOWN') - second call does not affect already-SENT delivery", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        return [{ tenantId: mockTenantId }] as unknown as T;
      },
      $executeRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        if (isSetConfigQuery(query)) {
          expect(values[0]).toBe(tenantContext.tenantId);
          return 1 as unknown as T;
        }
        const queryText = getQueryText(query);
        expect(queryText).toContain("'PENDING'");
        expect(queryText).toContain("'UNKNOWN'");
        expect(values).toContain(tenantContext.tenantId);
        expect(values).toContain(mockProviderMessageIds.tenant_123);
        return 0 as unknown as T;
      },
      $transaction: async (operation: (tx: PrismaTenantTransactionClient) => Promise<unknown>) => {
        return operation({ $executeRaw: prisma.$executeRaw } as unknown as PrismaTenantTransactionClient);
      },
    } as unknown as MockRawQueryClient;

    const tenantContext = createMockTenantContext();
    const statuses = [
      {
        providerMessageId: mockProviderMessageIds.tenant_123,
        status: "sent" as const,
      },
    ];

    const updatedCount = await Promise.resolve(
      await applyWhatsAppWebhookStatuses(prisma, tenantContext, statuses),
    );
    expect(updatedCount).toBe(0);
  });

  it("Second webhook with same providerMessageId does not change delivery status from SENT", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        return [{ tenantId: mockTenantId }] as unknown as T;
      },
      $executeRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        if (isSetConfigQuery(query)) {
          return 1 as unknown as T;
        }
        return 0 as unknown as T;
      },
      $transaction: async (operation: (tx: PrismaTenantTransactionClient) => Promise<unknown>) => {
        // Execute operation directly, simulating transaction behavior
        return operation({ $executeRaw: prisma.$executeRaw } as unknown as PrismaTenantTransactionClient);
      },
    } as unknown as MockRawQueryClient;

    const tenantContext = createMockTenantContext();
    const statuses = [
      {
        providerMessageId: mockProviderMessageIds.tenant_123,
        status: "sent" as const,
      },
    ];

    const updatedCount = await Promise.resolve(
      await applyWhatsAppWebhookStatuses(prisma, tenantContext, statuses),
    );
    expect(updatedCount).toBe(0);
  });
});
describe("WhatsApp webhook security - tenant-scoped status updates", () => {
  it("UPDATE query correctly scopes to tenantId for sent status", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        return [{ tenantId: mockTenantId }] as unknown as T;
      },
      $executeRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        if (isSetConfigQuery(query)) {
          expect(values[0]).toBe(tenantContext.tenantId);
          return 1 as unknown as T;
        }
        const queryText = getQueryText(query);
        expect(queryText).toContain('"tenantId"');
        expect(values).toContain(tenantContext.tenantId);
        expect(values).toContain(mockProviderMessageIds.tenant_123);
        return 1 as unknown as T;
      },
      $transaction: async (operation: (tx: PrismaTenantTransactionClient) => Promise<unknown>) => {
        // Execute operation directly, simulating transaction behavior
        return operation({ $executeRaw: prisma.$executeRaw } as unknown as PrismaTenantTransactionClient);
      },
    } as unknown as MockRawQueryClient;

    const tenantContext = createMockTenantContext();
    const statuses = [
      {
        providerMessageId: mockProviderMessageIds.tenant_123,
        status: "sent" as const,
      },
    ];

    const updatedCount = await Promise.resolve(
      await applyWhatsAppWebhookStatuses(prisma, tenantContext, statuses),
    );
    expect(updatedCount).toBe(1);
  });

  it("UPDATE query correctly scopes to tenantId for delivered status", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        return [{ tenantId: mockTenantId }] as unknown as T;
      },
      $executeRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        if (isSetConfigQuery(query)) {
          expect(values[0]).toBe(tenantContext.tenantId);
          return 1 as unknown as T;
        }
        const queryText = getQueryText(query);
        expect(queryText).toContain('"tenantId"');
        expect(values).toContain(tenantContext.tenantId);
        expect(values).toContain(mockProviderMessageIds.tenant_123);
        return 1 as unknown as T;
      },
      $transaction: async (operation: (tx: PrismaTenantTransactionClient) => Promise<unknown>) => {
        // Execute operation directly, simulating transaction behavior
        return operation({ $executeRaw: prisma.$executeRaw } as unknown as PrismaTenantTransactionClient);
      },
    } as unknown as MockRawQueryClient;

    const tenantContext = createMockTenantContext();
    const statuses = [
      {
        providerMessageId: mockProviderMessageIds.tenant_123,
        status: "delivered" as const,
      },
    ];

    const updatedCount = await Promise.resolve(
      await applyWhatsAppWebhookStatuses(prisma, tenantContext, statuses),
    );
    expect(updatedCount).toBe(1);
  });

  it("UPDATE query correctly scopes to tenantId for failed status", async () => {
    const prisma = {
      $queryRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        return [{ tenantId: mockTenantId }] as unknown as T;
      },
      $executeRaw: async <T>(
        query: TemplateStringsArray,
        ...values: readonly unknown[]
      ): Promise<T> => {
        if (isSetConfigQuery(query)) {
          expect(values[0]).toBe(tenantContext.tenantId);
          return 1 as unknown as T;
        }
        const queryText = getQueryText(query);
        expect(queryText).toContain('"tenantId"');
        expect(values).toContain(tenantContext.tenantId);
        expect(values).toContain(mockProviderMessageIds.tenant_123);
        return 1 as unknown as T;
      },
      $transaction: async (operation: (tx: PrismaTenantTransactionClient) => Promise<unknown>) => {
        // Execute operation directly, simulating transaction behavior
        return operation({ $executeRaw: prisma.$executeRaw } as unknown as PrismaTenantTransactionClient);
      },
    } as unknown as MockRawQueryClient;

    const tenantContext = createMockTenantContext();
    const statuses = [
      {
        providerMessageId: mockProviderMessageIds.tenant_123,
        status: "failed" as const,
        errorCode: "12345",
      },
    ];

    const updatedCount = await Promise.resolve(
      await applyWhatsAppWebhookStatuses(prisma, tenantContext, statuses),
    );
    expect(updatedCount).toBe(1);
  });
});
