import { describe, expect, it, vi } from "vitest";
import { createSupabaseAuthAdapter } from "./supabase-auth-adapter";

describe("createSupabaseAuthAdapter", () => {
  it("maps server-derived Supabase identity to subject only", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
      error: null,
    });

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "authenticated",
      subjectId: "supabase-user-1",
    });
  });

  it("maps only server-managed app_metadata tenant binding", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "supabase-user-1",
          app_metadata: { tenant_id: "tenant-1" },
        },
      },
      error: null,
    });

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "authenticated",
      subjectId: "supabase-user-1",
      tenantId: "tenant-1",
    });
  });

  it("does not perform profile or tenant resolution from user metadata", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "supabase-user-1",
          user_metadata: {
            tenant_id: "attacker-tenant",
            role: "SUPER_ADMIN",
            profileId: "attacker-profile",
          },
        },
      },
      error: null,
    });

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "authenticated",
      subjectId: "supabase-user-1",
    });
  });

  it("fails closed on provider error or missing user", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: new Error("auth unavailable"),
    });

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "unauthenticated",
    });
  });

  it("fails closed on malformed user identity", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "" } },
      error: null,
    });

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "unauthenticated",
    });
  });

  it("fails closed when the auth provider throws", async () => {
    const getUser = vi.fn().mockRejectedValue(new Error("provider failure"));

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "unauthenticated",
    });
  });
});
