import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantRole } from "../domain/authorization";
import type { TenantContext } from "../domain/tenant-context";
import {
  createWorkingHoursCloseMinute,
  createWorkingHoursDay,
  createWorkingHoursOpenMinute,
  type WorkingHoursRecord,
} from "../domain/working-hours";

type WorkingHoursManageRole = Extract<TenantRole, "TENANT_ADMIN" | "SUPER_ADMIN">;

export type WorkingHoursRepository = Readonly<{
  upsert(
    tenantContext: TenantContext,
    input: Readonly<{ dayOfWeek: number; openMinute: number; closeMinute: number }>,
  ): Promise<"created" | "updated" | "conflict">;
  remove(tenantContext: TenantContext, dayOfWeek: number): Promise<"removed" | "not_found">;
  list(tenantContext: TenantContext): Promise<ReadonlyArray<WorkingHoursRecord>>;
}>;

export type WorkingHoursAuthorizer = Readonly<{
  authorize(
    identity: ApplicationIdentity,
    tenantContext: TenantContext,
    requiredRole: WorkingHoursManageRole,
  ): Promise<boolean>;
}>;

export type WorkingHoursResult =
  | Readonly<{ status: "created" | "updated" | "removed" }>
  | Readonly<{ status: "listed"; workingHours: ReadonlyArray<WorkingHoursRecord> }>
  | Readonly<{ status: "UNAUTHORIZED" | "INVALID_INPUT" | "PERSISTENCE_FAILURE" | "NOT_FOUND" | "CONFLICT" }>;

export function createWorkingHoursManager(dependencies: Readonly<{
  authorizer: WorkingHoursAuthorizer;
  repository: WorkingHoursRepository;
}>) {
  return {
    async upsert(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
      input: Readonly<{ dayOfWeek: unknown; openMinute: unknown; closeMinute: unknown }>,
    ): Promise<WorkingHoursResult> {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) return { status: "UNAUTHORIZED" };
      try {
        const dayOfWeek = createWorkingHoursDay(input.dayOfWeek);
        const openMinute = createWorkingHoursOpenMinute(input.openMinute);
        const closeMinute = createWorkingHoursCloseMinute(input.closeMinute);
        if (closeMinute <= openMinute) return { status: "INVALID_INPUT" };
        const result = await dependencies.repository.upsert(tenantContext, { dayOfWeek, openMinute, closeMinute });
        if (result === "created") return { status: "created" };
        if (result === "updated") return { status: "updated" };
        return { status: "CONFLICT" };
      } catch {
        return { status: "INVALID_INPUT" };
      }
    },

    async remove(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
      dayOfWeek: unknown,
    ): Promise<WorkingHoursResult> {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) return { status: "UNAUTHORIZED" };
      let day: number;
      try { day = createWorkingHoursDay(dayOfWeek); } catch { return { status: "INVALID_INPUT" }; }
      try {
        const result = await dependencies.repository.remove(tenantContext, day);
        return result === "removed" ? { status: "removed" } : { status: "NOT_FOUND" };
      } catch { return { status: "PERSISTENCE_FAILURE" }; }
    },

    async list(
      identity: ApplicationIdentity,
      tenantContext: TenantContext,
    ): Promise<WorkingHoursResult> {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) return { status: "UNAUTHORIZED" };
      try {
        return { status: "listed", workingHours: await dependencies.repository.list(tenantContext) };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },
  };
}
