import { describe, expect, it, vi } from "vitest";
import { createTenantContext, createTenantId } from "../domain/tenant-context";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

function tenantContext(value: string) {
  const id = createTenantId(value);
  if (!id.ok) throw new Error(id.error.message);
  const context = createTenantContext({ tenantId: id.value });
  if (!context.ok) throw new Error(context.error.message);
  return context.value;
}

function mockTx() {
  const executeRaw = vi.fn().mockResolvedValue(1);
  return {
    tx: { $executeRaw: executeRaw, tenantMembership: { findUnique: vi.fn() } } satisfies PrismaTenantTransactionClient,
    executeRaw,
  };
}

describe("withPrismaTenantContext", () => {
  it("sets context before operation", async () => {
    const { tx, executeRaw } = mockTx();
    const order: string[] = [];
    executeRaw.mockImplementation(async () => { order.push("context"); return 1; });
    const transaction = vi.fn(async <T>(operation: (tx: PrismaTenantTransactionClient) => Promise<T>) => {
      order.push("transaction");
      return operation(tx);
    });
    const prisma = { $transaction: transaction } as unknown as PrismaTenantClient;

    await withPrismaTenantContext(prisma, tenantContext("tenant-a"), async () => {
      order.push("operation");
      return "ok";
    });

    expect(order).toEqual(["transaction", "context", "operation"]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw.mock.calls[0]?.[0]).toEqual([
      "SELECT set_config('app.tenant_id', ",
      ", true)",
    ]);
    expect(executeRaw.mock.calls[0]?.[1]).toBe("tenant-a");
  });

  it("propagates operation failures", async () => {
    const { tx } = mockTx();
    const failure = new Error("query failed");
    const transaction = vi.fn(async <T>(operation: (tx: PrismaTenantTransactionClient) => Promise<T>) => operation(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaTenantClient;

    await expect(
      withPrismaTenantContext(prisma, tenantContext("tenant-a"), async () => { throw failure; }),
    ).rejects.toBe(failure);
  });

  it("does not execute operation when context setup fails", async () => {
    const { tx, executeRaw } = mockTx();
    const failure = new Error("context failed");
    executeRaw.mockRejectedValue(failure);
    const operation = vi.fn();
    const transaction = vi.fn(async <T>(callback: (tx: PrismaTenantTransactionClient) => Promise<T>) => callback(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaTenantClient;

    await expect(
      withPrismaTenantContext(prisma, tenantContext("tenant-a"), operation),
    ).rejects.toBe(failure);

    expect(operation).not.toHaveBeenCalled();
  });
});
