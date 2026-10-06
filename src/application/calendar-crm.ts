import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import type { AppointmentRecord } from "../domain/appointment";

export type CalendarRepository = Readonly<{
  listCustomers(tenantContext: TenantContext, query: string): Promise<ReadonlyArray<Readonly<{ id: string; displayName: string; email: string | null; phone: string | null; appointmentCount: number; lastAppointmentAt: Date | null }>>>;
  listAppointments(tenantContext: TenantContext, range: Readonly<{ startAt: Date; endAt: Date; staffId?: string }>): Promise<ReadonlyArray<AppointmentRecord>>;
  customerCard(tenantContext: TenantContext, customerProfileId: string): Promise<Readonly<{
    id: string; displayName: string; email: string | null; phone: string | null;
    appointments: ReadonlyArray<AppointmentRecord>;
    notes: ReadonlyArray<Readonly<{ id: string; body: string; createdAt: Date }>>;
  }> | null>;
  addCustomerNote(tenantContext: TenantContext, customerProfileId: string, body: string): Promise<"created" | "not_found">;
}>;

export type CalendarAuthorizer = Readonly<{
  authorize(identity: ApplicationIdentity, tenantContext: TenantContext, role: "TENANT_ADMIN"): Promise<boolean>;
}>;

export function createCalendarCrm(dependencies: Readonly<{ repository: CalendarRepository; authorizer: CalendarAuthorizer }>) {
  return {
    async customers(identity: ApplicationIdentity, tenantContext: TenantContext, query: unknown) {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) return { status: "UNAUTHORIZED" as const };
      if (typeof query !== "string" || query.length > 100 || /[\\u0000-\\u001f\\u007f]/.test(query)) return { status: "INVALID_INPUT" as const };
      try { return { status: "ok" as const, customers: await dependencies.repository.listCustomers(tenantContext, query.trim()) }; }
      catch { return { status: "PERSISTENCE_FAILURE" as const }; }
    },

    async calendar(identity: ApplicationIdentity, tenantContext: TenantContext, range: Readonly<{ startAt: Date; endAt: Date; staffId?: string }>) {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) return { status: "UNAUTHORIZED" as const };
      if (!(range.startAt instanceof Date) || !(range.endAt instanceof Date) || range.startAt >= range.endAt) return { status: "INVALID_INPUT" as const };
      try { return { status: "ok" as const, appointments: await dependencies.repository.listAppointments(tenantContext, range) }; }
      catch { return { status: "PERSISTENCE_FAILURE" as const }; }
    },

    async customer(identity: ApplicationIdentity, tenantContext: TenantContext, customerProfileId: string) {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) return { status: "UNAUTHORIZED" as const };
      if (!customerProfileId.trim()) return { status: "INVALID_INPUT" as const };
      try {
        const card = await dependencies.repository.customerCard(tenantContext, customerProfileId);
        return card ? { status: "ok" as const, customer: card } : { status: "NOT_FOUND" as const };
      } catch { return { status: "PERSISTENCE_FAILURE" as const }; }
    },

    async addNote(identity: ApplicationIdentity, tenantContext: TenantContext, customerProfileId: string, body: unknown) {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN"))) return { status: "UNAUTHORIZED" as const };
      if (typeof body !== "string" || !body.trim() || /[\u0000-\u001f\u007f]/.test(body)) return { status: "INVALID_INPUT" as const };
      try {
        const result = await dependencies.repository.addCustomerNote(tenantContext, customerProfileId, body.trim());
        return result === "created" ? { status: "created" as const } : { status: "NOT_FOUND" as const };
      } catch { return { status: "PERSISTENCE_FAILURE" as const }; }
    },
  };
}
