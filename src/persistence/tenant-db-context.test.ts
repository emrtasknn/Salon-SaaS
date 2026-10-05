import { describe, expect, it, vi } from "vitest";
import { createTenantContext, createTenantId } from "../domain/tenant-context";
import {
  withTenantDatabaseContext,
  type TenantDatabaseClient,
} from "./tenant-db-context";

function tenantContext(raw: string) {
  const tenantIdResult = createTenantId(raw);
  if (!tenantIdResult.ok) throw new Error("test setup failed");

  const result = createTenantContext({
    tenantId: tenantIdResult.value,
  });

  if (!result.ok) throw new Error("test setup failed");
  return result.value;
}

describe("withTenantDatabaseContext", () => {
  it("sets tenant context transaction-locally before the operation", async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const client: TenantDatabaseClient = {
      query: vi.fn(async (text: string, values?: readonly unknown[]) => {
        calls.push({ text, values });
        return undefined;
      }),
    };

    const result = await withTenantDatabaseContext(
      client,
      tenantContext("tenant-a"),
      async () => "ok",
    );

    expect(result).toBe("ok");
    expect(calls).toEqual([
      { text: "BEGIN", values: undefined },
      {
        text: "SELECT set_config('app.tenant_id', $1, true)",
        values: ["tenant-a"],
      },
      { text: "COMMIT", values: undefined },
    ]);
  });

  it("rolls back and preserves the operation error", async () => {
    const client: TenantDatabaseClient = {
      query: vi.fn(async (text: string) => {
        if (text === "ROLLBACK") return undefined;
        return undefined;
      }),
    };
    const error = new Error("db failure");

    await expect(
      withTenantDatabaseContext(
        client,
        tenantContext("tenant-a"),
        async () => {
          throw error;
        },
      ),
    ).rejects.toBe(error);

    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("does not commit after a failed context setup", async () => {
    const calls: string[] = [];
    const client: TenantDatabaseClient = {
      query: vi.fn(async (text: string) => {
        calls.push(text);
        if (text.includes("set_config")) throw new Error("context failure");
        return undefined;
      }),
    };

    await expect(
      withTenantDatabaseContext(
        client,
        tenantContext("tenant-a"),
        async () => "never",
      ),
    ).rejects.toThrow("context failure");

    expect(calls).toEqual([
      "BEGIN",
      "SELECT set_config('app.tenant_id', $1, true)",
      "ROLLBACK",
    ]);
  });
});
