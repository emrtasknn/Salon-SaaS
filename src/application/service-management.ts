import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantRole } from "../domain/authorization";
import type { TenantContext } from "../domain/tenant-context";
import {
  createServiceBufferMinutes,
  createServiceDurationMinutes,
  normalizeServiceName,
  type ServiceRecord,
} from "../domain/service";

type ServiceManageRole = Extract<TenantRole, "TENANT_ADMIN" | "SUPER_ADMIN">;

export type ServiceCreateInput = Readonly<{
  identity: ApplicationIdentity;
  tenantContext: TenantContext;
  name: unknown;
  durationMinutes: unknown;
  bufferMinutes?: unknown;
}>;

export type ServiceUpdateInput = Readonly<{
  identity: ApplicationIdentity;
  tenantContext: TenantContext;
  serviceId: string;
  name?: unknown;
  durationMinutes?: unknown;
  bufferMinutes?: unknown;
}>;

export type ServiceRepository = Readonly<{
  create(
    tenantContext: TenantContext,
    input: Readonly<{ name: string; durationMinutes: number; bufferMinutes: number }>,
  ): Promise<"created" | "conflict">;
  update(
    tenantContext: TenantContext,
    serviceId: string,
    patch: Readonly<{ name?: string; durationMinutes?: number; bufferMinutes?: number }>,
  ): Promise<"updated" | "not_found" | "conflict">;
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
      try {
        name = normalizeServiceName(input.name);
        durationMinutes = createServiceDurationMinutes(input.durationMinutes);
        bufferMinutes = createServiceBufferMinutes(input.bufferMinutes ?? 0);
      } catch {
        return { status: "INVALID_INPUT" };
      }

      try {
        const result = await dependencies.repository.create(input.tenantContext, {
          name,
          durationMinutes,
          bufferMinutes,
        });
        return result === "created" ? { status: "created" } : { status: "CONFLICT" };
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

      const patch: { name?: string; durationMinutes?: number; bufferMinutes?: number } = {};

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
      if (Object.keys(patch).length === 0) return { status: "INVALID_INPUT" };

      try {
        const result = await dependencies.repository.update(input.tenantContext, input.serviceId, patch);
        if (result === "updated") return { status: "updated" };
        if (result === "not_found") return { status: "NOT_FOUND" };
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
