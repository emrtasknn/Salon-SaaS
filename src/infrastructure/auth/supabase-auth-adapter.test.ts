import { describe, expect, it } from "vitest";
import { createSupabaseAuthAdapter } from "./supabase-auth-adapter";

describe("createSupabaseAuthAdapter", () => {
  it("reads tenant_id and platform_role from trusted app_metadata", async () => {
    const adapter = createSupabaseAuthAdapter({
      client: {
        auth: {
          async getUser() {
            return {
              error: null,
              data: {
                user: {
                  id: "subject-a",
                  app_metadata: {
                    tenant_id: "tenant-a",
                    platform_role: "SUPER_ADMIN",
                  },
                },
              },
            };
          },
        },
      },
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "authenticated",
      subjectId: "subject-a",
      tenantId: "tenant-a",
      platformRole: "SUPER_ADMIN",
    });
  });

  it("does not infer a platform role when app_metadata is absent", async () => {
    const adapter = createSupabaseAuthAdapter({
      client: {
        auth: {
          async getUser() {
            return {
              error: null,
              data: {
                user: { id: "subject-a", app_metadata: {} },
              },
            };
          },
        },
      },
    });

    await expect(adapter.readIdentity()).resolves.toEqual({
      state: "authenticated",
      subjectId: "subject-a",
    });
  });
});
