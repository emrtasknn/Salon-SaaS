import { describe, expect, it } from "vitest";

import {
  createAuthProfileMapping,
  createAuthSubjectId,
  createAuthenticatedIdentity,
  createUnauthenticatedIdentity,
} from "./auth-identity";

describe("auth identity foundation", () => {
  it("creates a valid opaque auth subject ID", () => {
    expect(createAuthSubjectId("provider-subject-123")).toBe("provider-subject-123");
  });

  it("rejects malformed auth subject IDs", () => {
    expect(() => createAuthSubjectId("")).toThrow(TypeError);
    expect(() => createAuthSubjectId(" subject")).toThrow(TypeError);
    expect(() => createAuthSubjectId("subject ")).toThrow(TypeError);
    expect(() => createAuthSubjectId("subject\nvalue")).toThrow(TypeError);
    expect(() => createAuthSubjectId("x".repeat(129))).toThrow(TypeError);
    expect(() => createAuthSubjectId(123)).toThrow(TypeError);
  });

  it("represents unauthenticated state explicitly", () => {
    expect(createUnauthenticatedIdentity()).toEqual({
      state: "unauthenticated",
    });
  });

  it("represents authenticated state explicitly", () => {
    expect(createAuthenticatedIdentity("subject-1", "profile-1")).toEqual({
      state: "authenticated",
      subjectId: "subject-1",
      profileId: "profile-1",
    });
  });

  it("rejects an invalid profile identity", () => {
    expect(() => createAuthenticatedIdentity("subject-1", "")).toThrow(TypeError);
    expect(() => createAuthenticatedIdentity("subject-1", " profile-1")).toThrow(TypeError);
  });

  it("keeps provider subject separate from profile identity", () => {
    expect(createAuthProfileMapping("provider-42", "profile-42")).toEqual({
      subjectId: "provider-42",
      profileId: "profile-42",
    });
  });

  it("does not introduce tenant identity into the auth contract", () => {
    const identity = createAuthenticatedIdentity("subject-1", "profile-1");
    expect(identity).not.toHaveProperty("tenantId");
  });
});
