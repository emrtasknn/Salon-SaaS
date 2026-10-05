import { describe, expect, it, vi } from "vitest";
import {
  readAuthenticatedSubject,
  type ServerAuthAdapter,
} from "./auth-request-boundary";

describe("readAuthenticatedSubject", () => {
  it("maps trusted authenticated server state to a subject-only identity", async () => {
    const adapter: ServerAuthAdapter = {
      readIdentity: vi.fn().mockResolvedValue({
        state: "authenticated",
        subjectId: "subject-a",
      }),
    };

    await expect(readAuthenticatedSubject(adapter)).resolves.toEqual({
      state: "authenticated",
      subjectId: "subject-a",
    });
  });

  it("maps unauthenticated state explicitly", async () => {
    const adapter: ServerAuthAdapter = {
      readIdentity: vi.fn().mockResolvedValue({
        state: "unauthenticated",
      }),
    };

    await expect(readAuthenticatedSubject(adapter)).resolves.toEqual({
      state: "unauthenticated",
    });
  });

  it("fails closed for malformed authenticated state", async () => {
    const adapter: ServerAuthAdapter = {
      readIdentity: vi.fn().mockResolvedValue({
        state: "authenticated",
        subjectId: "",
      }),
    };

    await expect(readAuthenticatedSubject(adapter)).resolves.toEqual({
      state: "unauthenticated",
    });
  });

  it("fails closed when the auth adapter throws", async () => {
    const adapter: ServerAuthAdapter = {
      readIdentity: vi.fn().mockRejectedValue(new Error("auth unavailable")),
    };

    await expect(readAuthenticatedSubject(adapter)).resolves.toEqual({
      state: "unauthenticated",
    });
  });

  it("does not accept profile, tenant, or role metadata as authentication inputs", async () => {
    const adapter: ServerAuthAdapter = {
      readIdentity: vi.fn().mockResolvedValue({
        state: "authenticated",
        subjectId: "subject-a",
        profileId: "attacker-profile",
        tenantId: "attacker-tenant",
        role: "SUPER_ADMIN",
      }),
    };

    await expect(readAuthenticatedSubject(adapter)).resolves.toEqual({
      state: "authenticated",
      subjectId: "subject-a",
    });
  });
});
