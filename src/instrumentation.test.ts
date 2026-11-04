import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

const VALID = "v".repeat(32);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instrumentation register", () => {
  it("throws in production on the nodejs runtime without a secret", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", undefined);
    await expect(register()).rejects.toThrow(/RATE_LIMIT_HMAC_SECRET is missing/);
  });

  it("throws in production with a short secret", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "short");
    await expect(register()).rejects.toThrow(/shorter than 32 bytes/);
  });

  it("starts in production with a valid secret", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", VALID);
    await expect(register()).resolves.toBeUndefined();
  });

  it.each(["edge", undefined])("skips on non-nodejs runtime %j", async (runtime) => {
    vi.stubEnv("NEXT_RUNTIME", runtime);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", undefined);
    await expect(register()).resolves.toBeUndefined();
  });

  it("skips during the production build phase", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", undefined);
    await expect(register()).resolves.toBeUndefined();
  });

  it("does not throw outside production without a secret", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", undefined);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", undefined);
    await expect(register()).resolves.toBeUndefined();
  });
});
