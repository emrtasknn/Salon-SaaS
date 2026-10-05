import { describe, expect, it, vi } from "vitest";
import {
  readApplicationIdentity,
  type ServerAuthAdapter,
} from "./auth-request-boundary";

describe("readApplicationIdentity", () => {
  it("maps trusted authenticated server state to ApplicationIdentity", async () => {
    const adapter: ServerAuthAdapter = {
      readIdentity: vi.fn().mockResolvedValue({
        state: "authenticated",
        subjectId: "subject-a",
        profileId: "profile-a",
      }),
    };

    await expect(readApplicationIdentity(adapter)).resolves.toEqual({
      state: "authenticated",
      subjectId: "subject-a",
      profileId: "profile-a",
    });
  });

  it("maps unauthenticated state explicitly", async () => {
    const adapter: ServerAuthAdapter = {
      readIdentity: vi.fn().mockResolvedValue({
        state: "unauthenticated",
      }),
    };

    await expect(readApplicationIdentity(adapter)).resolves.toEqual({
      state: "unauthenticated",
    });
  });

  it("fails closed for malformed authenticated state", async () => {
    const adapter: ServerAuthAdapter = {
      readIdentity: vi.fn().mockResolvedValue({
        state: "authenticated",
        subjectId: "",
        profileId: "profile-a",
      }),
    };

    await expect(readApplicationIdentity(adapter)).resolves.toEqual({
      state: "unauthenticated",
    });
  });

  it("fails closed when the auth adapter throws", async () => {
    const adapter: ServerAuthAdapter = {
      readIdentity: vi.fn().mockRejectedValue(new Error("auth unavailable")),
    };

    await expect(readApplicationIdentity(adapter)).resolves.toEqual({
      state: "unauthenticated",
    });
  });

  it("does not accept tenant or role fields as authentication inputs", async () => {
    const adapter: ServerAuthAdapter = {
      readIdentity: vi.fn().mockResolvedValue({
        state: "authenticated",
        subjectId: "subject-a",
        profileId: "profile-a",
        tenantId: "attacker-tenant",
        role: "SUPER_ADMIN",
      }),
    };

    await expect(readApplicationIdentity(adapter)).resolves.toEqual({
      state: "authenticated",
      subjectId: "subject-a",
      profileId: "profile-a",
    });
  });
});
