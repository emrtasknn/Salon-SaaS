import { describe, expect, it, vi } from "vitest";
import { createSupabaseAuthAdapter } from "./supabase-auth-adapter";

describe("createSupabaseAuthAdapter", () => {
  it("maps server-derived Supabase identity and profile mapping", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
      error: null,
    });
    const resolveProfileId = vi.fn().mockResolvedValue("profile-1");

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
      resolveProfileId,
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "authenticated",
      subjectId: "supabase-user-1",
      profileId: "profile-1",
    });
    expect(resolveProfileId).toHaveBeenCalledWith("supabase-user-1");
  });

  it("fails closed on provider error or missing user", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: new Error("auth unavailable"),
    });
    const resolveProfileId = vi.fn();

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
      resolveProfileId,
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "unauthenticated",
    });
    expect(resolveProfileId).not.toHaveBeenCalled();
  });

  it("fails closed on malformed user identity", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "" } },
      error: null,
    });
    const resolveProfileId = vi.fn();

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
      resolveProfileId,
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "unauthenticated",
    });
    expect(resolveProfileId).not.toHaveBeenCalled();
  });

  it("fails closed when profile mapping fails", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
      error: null,
    });
    const resolveProfileId = vi
      .fn()
      .mockRejectedValue(new Error("profile unavailable"));

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
      resolveProfileId,
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "unauthenticated",
    });
  });

  it("ignores tenant, role, and profile metadata from the auth user", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "supabase-user-1",
          tenantId: "attacker-tenant",
          role: "SUPER_ADMIN",
          profileId: "attacker-profile",
        },
      },
      error: null,
    });
    const resolveProfileId = vi.fn().mockResolvedValue("profile-1");

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
      resolveProfileId,
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "authenticated",
      subjectId: "supabase-user-1",
      profileId: "profile-1",
    });
  });

  it("fails closed when the auth provider throws", async () => {
    const getUser = vi.fn().mockRejectedValue(new Error("provider failure"));
    const resolveProfileId = vi.fn();

    const adapter = createSupabaseAuthAdapter({
      client: { auth: { getUser } },
      resolveProfileId,
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "unauthenticated",
    });
  });
});
