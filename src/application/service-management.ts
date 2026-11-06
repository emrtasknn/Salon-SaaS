import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantRole } from "../domain/authorization";
import type { TenantContext } from "../domain/tenant-context";
import {
  createServiceBufferMinutes,
  createServiceDurationMinutes,
  normalizeServiceName,
  type ServiceRecord,
} from "../domain/service";
import { createServicePrice } from "../domain/service-price";

type ServiceManageRole = Extract<TenantRole, "TENANT_ADMIN" | "SUPER_ADMIN">;

export type ServiceCreateInput = Readonly<{
  identity: ApplicationIdentity;
  tenantContext: TenantContext;
  name: unknown;
  durationMinutes: unknown;
  bufferMinutes?: unknown;
  /** Category of the same tenant, or null for none (owner decision 2026-11-06). */
  categoryId?: unknown;
  /** Kuruş or null. */
  priceMinor?: unknown;
  priceIsFrom?: unknown;
}>;

export type ServiceUpdateInput = Readonly<{
  identity: ApplicationIdentity;
  tenantContext: TenantContext;
  serviceId: string;
  name?: unknown;
  durationMinutes?: unknown;
  bufferMinutes?: unknown;
  categoryId?: unknown;
  /** Price fields are updated together (priceMinor + priceIsFrom). */
  priceMinor?: unknown;
  priceIsFrom?: unknown;
}>;

/** Optional catalogue fields; only keys that were provided are written. */
export type ServiceCatalogPatch = { categoryId?: string | null; priceMinor?: number | null; priceIsFrom?: boolean };

export type ServiceRepository = Readonly<{
  create(
    tenantContext: TenantContext,
    input: Readonly<{ name: string; durationMinutes: number; bufferMinutes: number } & ServiceCatalogPatch>,
  ): Promise<"created" | "conflict" | "category_not_found">;
  update(
    tenantContext: TenantContext,
    serviceId: string,
    patch: Readonly<{ name?: string; durationMinutes?: number; bufferMinutes?: number } & ServiceCatalogPatch>,
  ): Promise<"updated" | "not_found" | "conflict" | "category_not_found">;
  setActive(
    tenantContext: TenantContext,
    serviceId: string,
    active: boolean,
  ): Promise<"updated" | "not_found">;
  list(tenantContext: TenantContext): Promise<ReadonlyArray<ServiceRecord>>;
}>;

export type ServiceManagementAuthorizer = Readonly<{
  authorize(
    identity: ApplicationIdentity,
    tenantContext: TenantContext,
    requiredRole: ServiceManageRole,
  ): Promise<boolean>;
}>;

export type ServiceManagementResult =
  | Readonly<{ status: "created" }>
  | Readonly<{ status: "updated" }>
  | Readonly<{ status: "listed"; services: ReadonlyArray<ServiceRecord> }>
  | Readonly<{
      status:
        | "UNAUTHORIZED"
        | "INVALID_INPUT"
        | "PERSISTENCE_FAILURE"
        | "NOT_FOUND"
        | "CONFLICT";
    }>;

function normalizeOptionalNumber(
  value: unknown,
  factory: (value: unknown) => number,
): number | "INVALID" {
  try {
    return factory(value);
  } catch {
    return "INVALID";
  }
}

const ID_MAX_LENGTH = 100;

function readCategoryId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > ID_MAX_LENGTH || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError("Category id is invalid");
  }
  return value;
}

/**
 * Reads the optional category/price fields. `requirePricePair` (updates) demands priceMinor and
 * priceIsFrom together so the DB CHECK (starting price needs a price) can never be half-applied.
 */
function readCatalogPatch(input: Readonly<Record<string, unknown>>, requirePricePair: boolean): ServiceCatalogPatch {
  const patch: ServiceCatalogPatch = {};
  if ("categoryId" in input && input.categoryId !== undefined) patch.categoryId = readCategoryId(input.categoryId);
  const hasPrice = "priceMinor" in input && input.priceMinor !== undefined;
  const hasFlag = "priceIsFrom" in input && input.priceIsFrom !== undefined;
  if (hasPrice || hasFlag) {
    if (requirePricePair && !(hasPrice && hasFlag)) throw new TypeError("Price fields must be updated together");
    if (!hasPrice) throw new TypeError("A starting price needs a price");
    const price = createServicePrice(input.priceMinor, hasFlag ? input.priceIsFrom : false);
    patch.priceMinor = price.priceMinor;
    patch.priceIsFrom = price.priceIsFrom;
  }
  return patch;
}

export function createServiceManager(dependencies: Readonly<{
  authorizer: ServiceManagementAuthorizer;
  repository: ServiceRepository;
}>) {
  return {
    async create(input: ServiceCreateInput): Promise<ServiceManagementResult> {
      if (!(await dependencies.authorizer.authorize(input.identity, input.tenantContext, "TENANT_ADMIN"))) {
        return { status: "UNAUTHORIZED" };
      }

      let name: string;
      let durationMinutes: number;
      let bufferMinutes: number;
      let catalog: ServiceCatalogPatch;
      try {
        name = normalizeServiceName(input.name);
        durationMinutes = createServiceDurationMinutes(input.durationMinutes);
        bufferMinutes = createServiceBufferMinutes(input.bufferMinutes ?? 0);
        catalog = readCatalogPatch(input, false);
      } catch {
        return { status: "INVALID_INPUT" };
      }

      try {
        const result = await dependencies.repository.create(input.tenantContext, {
          name,
          durationMinutes,
          bufferMinutes,
          ...catalog,
        });
        if (result === "created") return { status: "created" };
        if (result === "category_not_found") return { status: "NOT_FOUND" };
        return { status: "CONFLICT" };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },

    async update(input: ServiceUpdateInput): Promise<ServiceManagementResult> {
      if (!(await dependencies.authorizer.authorize(input.identity, input.tenantContext, "TENANT_ADMIN"))) {
        return { status: "UNAUTHORIZED" };
      }
      if (typeof input.serviceId !== "string" || input.serviceId.trim() === "") {
        return { status: "INVALID_INPUT" };
      }

      const patch: { name?: string; durationMinutes?: number; bufferMinutes?: number } & ServiceCatalogPatch = {};

      if ("name" in input) {
        try {
          patch.name = normalizeServiceName(input.name);
        } catch {
          return { status: "INVALID_INPUT" };
        }
      }
      if ("durationMinutes" in input) {
        const value = normalizeOptionalNumber(input.durationMinutes, createServiceDurationMinutes);
        if (value === "INVALID") return { status: "INVALID_INPUT" };
        patch.durationMinutes = value;
      }
      if ("bufferMinutes" in input) {
        const value = normalizeOptionalNumber(input.bufferMinutes, createServiceBufferMinutes);
        if (value === "INVALID") return { status: "INVALID_INPUT" };
        patch.bufferMinutes = value;
      }
      try {
        Object.assign(patch, readCatalogPatch(input, true));
      } catch {
        return { status: "INVALID_INPUT" };
      }
      if (Object.keys(patch).length === 0) return { status: "INVALID_INPUT" };

      try {
        const result = await dependencies.repository.update(input.tenantContext, input.serviceId, patch);
        if (result === "updated") return { status: "updated" };
        if (result === "not_found" || result === "category_not_found") return { status: "NOT_FOUND" };
        return { status: "CONFLICT" };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },

    async setActive(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
      serviceId: string,
      active: unknown,
    ): Promise<ServiceManagementResult> {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) {
        return { status: "UNAUTHORIZED" };
      }
      if (typeof serviceId !== "string" || serviceId.trim() === "" || typeof active !== "boolean") {
        return { status: "INVALID_INPUT" };
      }

      try {
        const result = await dependencies.repository.setActive(tenantContext, serviceId, active);
        return result === "updated" ? { status: "updated" } : { status: "NOT_FOUND" };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },

    async list(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
    ): Promise<ServiceManagementResult> {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) {
        return { status: "UNAUTHORIZED" };
      }

      try {
        return {
          status: "listed",
          services: await dependencies.repository.list(tenantContext),
        };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },
  };
}
