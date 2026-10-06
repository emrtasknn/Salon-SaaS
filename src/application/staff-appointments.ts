import type { ApplicationIdentity } from "../domain/auth-identity";
import type { AppointmentRecord, AppointmentStatus } from "../domain/appointment";
import type { TenantContext } from "../domain/tenant-context";

export type StaffAppointmentsRepository = Readonly<{
  listForStaff(tenantContext: TenantContext, staffId: string, range: { startAt: Date; endAt: Date }): Promise<ReadonlyArray<AppointmentRecord>>;
  findById(tenantContext: TenantContext, appointmentId: string): Promise<AppointmentRecord | null>;
}>;

export type StaffAppointmentsAuthorizer = Readonly<{
  authorizeStaffDecision(identity: ApplicationIdentity, tenantContext: TenantContext, appointment: AppointmentRecord): Promise<boolean>;
  authorizeAdmin(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean>;
}>;

export function createStaffAppointments(dependencies: Readonly<{ repository: StaffAppointmentsRepository; authorizer: StaffAppointmentsAuthorizer }>) {
  return {
    async list(identity: ApplicationIdentity, tenantContext: TenantContext, staffId: string, range: { startAt: Date; endAt: Date }) {
      if (identity.state !== "authenticated" || !staffId || range.startAt >= range.endAt) return { status: "INVALID_INPUT" as const };
      try {
        const appointments = await dependencies.repository.listForStaff(tenantContext, staffId, range);
        return { status: "ok" as const, appointments };
      } catch {
        return { status: "PERSISTENCE_FAILURE" as const };
      }
    },

    async decide(identity: ApplicationIdentity, tenantContext: TenantContext, appointmentId: string, to: Extract<AppointmentStatus, "CONFIRMED" | "REJECTED">) {
      if (!appointmentId || (to !== "CONFIRMED" && to !== "REJECTED")) return { status: "INVALID_INPUT" as const };
      const appointment = await dependencies.repository.findById(tenantContext, appointmentId);
      if (!appointment) return { status: "NOT_FOUND" as const };
      if (!(await dependencies.authorizer.authorizeStaffDecision(identity, tenantContext, appointment))) {
        return { status: "UNAUTHORIZED" as const };
      }
      if (appointment.status !== "PENDING") return { status: "INVALID_TRANSITION" as const };
      return { status: "AUTHORIZED" as const, appointment };
    },
  };
}
