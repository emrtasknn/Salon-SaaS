import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import { normalizeCategoryName, type ServiceCategoryRecord } from "../domain/service-category";

/** Owner decision 2026-11-06: TENANT_ADMIN manages the salon's service categories. */
export type ServiceCategoryRepository = Readonly<{
  list(tenantContext: TenantContext): Promise<ReadonlyArray<ServiceCategoryRecord>>;
  /** Appends at the end (max sortOrder + 1). */
  create(tenantContext: TenantContext, name: string): Promise<"created" | "conflict">;
  rename(tenantContext: TenantContext, categoryId: string, name: string): Promise<"updated" | "not_found" | "conflict">;
  /** Swaps sortOrder with the neighbour; at the edge it is a no-op that still reports "updated". */
  move(tenantContext: TenantContext, categoryId: string, direction: "up" | "down"): Promise<"updated" | "not_found">;
  /** Clears categoryId on its services, then deletes the category, in one transaction. */
  remove(tenantContext: TenantContext, categoryId: string): Promise<"deleted" | "not_found">;
}>;

export type ServiceCategoryAuthorizer = Readonly<{
  authorize(identity: ApplicationIdentity, tenantContext: TenantContext, requiredRole: "TENANT_ADMIN"): Promise<boolean>;
}>;

type Failure = Readonly<{ status: "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "PERSISTENCE_FAILURE" }>;

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

export function createServiceCategoryManager(dependencies: Readonly<{
  authorizer: ServiceCategoryAuthorizer;
  repository: ServiceCategoryRepository;
}>) {
  const allowed = (identity: ApplicationIdentity, tenantContext: TenantContext) =>
    dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN");

  async function guard<T>(run: () => Promise<T>): Promise<T | Failure> {
    try {
      return await run();
    } catch {
      return { status: "PERSISTENCE_FAILURE" };
    }
  }

  return {
    async list(identity: ApplicationIdentity, tenantContext: TenantContext) {
      if (!(await allowed(identity, tenantContext))) return { status: "UNAUTHORIZED" } as Failure;
      return guard(async () => ({ status: "listed" as const, categories: [...(await dependencies.repository.list(tenantContext))] }));
    },

    async create(identity: ApplicationIdentity, tenantContext: TenantContext, name: unknown) {
      if (!(await allowed(identity, tenantContext))) return { status: "UNAUTHORIZED" } as Failure;
      let normalized: string;
      try {
        normalized = normalizeCategoryName(name);
      } catch {
        return { status: "INVALID_INPUT" } as Failure;
      }
      return guard(async () => {
        const result = await dependencies.repository.create(tenantContext, normalized);
        return result === "created" ? { status: "created" as const } : ({ status: "CONFLICT" } as Failure);
      });
    },

    async rename(identity: ApplicationIdentity, tenantContext: TenantContext, categoryId: unknown, name: unknown) {
      if (!(await allowed(identity, tenantContext))) return { status: "UNAUTHORIZED" } as Failure;
      if (!isId(categoryId)) return { status: "INVALID_INPUT" } as Failure;
      let normalized: string;
      try {
        normalized = normalizeCategoryName(name);
      } catch {
        return { status: "INVALID_INPUT" } as Failure;
      }
      return guard(async () => {
        const result = await dependencies.repository.rename(tenantContext, categoryId, normalized);
        if (result === "updated") return { status: "updated" as const };
        return { status: result === "not_found" ? "NOT_FOUND" : "CONFLICT" } as Failure;
      });
    },

    async move(identity: ApplicationIdentity, tenantContext: TenantContext, categoryId: unknown, direction: unknown) {
      if (!(await allowed(identity, tenantContext))) return { status: "UNAUTHORIZED" } as Failure;
      if (!isId(categoryId) || (direction !== "up" && direction !== "down")) return { status: "INVALID_INPUT" } as Failure;
      return guard(async () => {
        const result = await dependencies.repository.move(tenantContext, categoryId, direction);
        return result === "updated" ? { status: "updated" as const } : ({ status: "NOT_FOUND" } as Failure);
      });
    },

    async remove(identity: ApplicationIdentity, tenantContext: TenantContext, categoryId: unknown) {
      if (!(await allowed(identity, tenantContext))) return { status: "UNAUTHORIZED" } as Failure;
      if (!isId(categoryId)) return { status: "INVALID_INPUT" } as Failure;
      return guard(async () => {
        const result = await dependencies.repository.remove(tenantContext, categoryId);
        return result === "deleted" ? { status: "deleted" as const } : ({ status: "NOT_FOUND" } as Failure);
      });
    },
  };
}
