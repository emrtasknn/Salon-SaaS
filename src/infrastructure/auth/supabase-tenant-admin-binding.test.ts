import { describe, expect, it, vi } from "vitest";
import { createSupabaseTenantAdminAuthBinding } from "./supabase-tenant-admin-binding";

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("supabase tenant admin auth binding", () => {
  it("binds an unbound subject without replacing existing metadata", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(200, { app_metadata: { plan: "pro" } }))
      .mockResolvedValueOnce(response(200, {}));

    const binding = createSupabaseTenantAdminAuthBinding({
      url: "https://x.supabase.co",
      serviceRoleKey: "secret",
      fetcher,
    });

    await expect(binding.bindTenant("auth-1" as never, "tenant-1")).resolves.toEqual({
      status: "bound",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/auth/v1/admin/users/auth-1"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          app_metadata: { plan: "pro", tenant_id: "tenant-1" },
        }),
      }),
    );
  });

  it("does not overwrite a subject already bound to another tenant", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response(200, { app_metadata: { tenant_id: "tenant-2" } }),
    );
    const binding = createSupabaseTenantAdminAuthBinding({
      url: "https://x.supabase.co",
      serviceRoleKey: "secret",
      fetcher,
    });

    await expect(binding.bindTenant("auth-1" as never, "tenant-1")).resolves.toEqual({
      status: "failed",
      reason: "CONFLICT",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports an already bound subject idempotently", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response(200, { app_metadata: { tenant_id: "tenant-1" } }),
    );
    const binding = createSupabaseTenantAdminAuthBinding({
      url: "https://x.supabase.co",
      serviceRoleKey: "secret",
      fetcher,
    });

    await expect(binding.bindTenant("auth-1" as never, "tenant-1")).resolves.toEqual({
      status: "already_bound",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rolls back only the binding owned by the provisioning attempt", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(200, { app_metadata: { plan: "pro", tenant_id: "tenant-1" } }))
      .mockResolvedValueOnce(response(200, {}));

    const binding = createSupabaseTenantAdminAuthBinding({
      url: "https://x.supabase.co",
      serviceRoleKey: "secret",
      fetcher,
    });

    await expect(binding.rollbackTenantBinding("auth-1" as never, "tenant-1")).resolves.toEqual({
      status: "rolled_back",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ app_metadata: { plan: "pro" } }),
      }),
    );
  });
});
