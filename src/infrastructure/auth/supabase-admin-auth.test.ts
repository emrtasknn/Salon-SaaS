import { describe, expect, it, vi } from "vitest";
import { createSupabaseAdminAuthProvisioner } from "./supabase-admin-auth";

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("supabase admin auth provisioning", () => {
  it("returns provider-derived subject on invite", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { id: "auth-1" }));
    const p = createSupabaseAdminAuthProvisioner({ url: "https://x.supabase.co", serviceRoleKey: "secret", fetcher });
    const result = await p.provision({ email: "staff@example.com", displayName: "Staff", tenantId: "tenant-1" });
    expect(result).toEqual({ status: "created", subjectId: "auth-1" });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/auth/v1/invite"), expect.objectContaining({ method: "POST" }));
  });
  it("compensates only the created subject", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(204, null));
    const p = createSupabaseAdminAuthProvisioner({ url: "https://x.supabase.co", serviceRoleKey: "secret", fetcher });
    const result = await p.compensate("auth-1" as never);
    expect(result.status).toBe("compensated");
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/auth/v1/admin/users/auth-1"), expect.objectContaining({ method: "DELETE" }));
  });
  it("fails without credentials", async () => {
    const p = createSupabaseAdminAuthProvisioner({ url: "", serviceRoleKey: "" });
    expect((await p.provision({ displayName: "Staff", tenantId: "tenant-1" })).status).toBe("failed");
  });
});
