import type { ApplicationIdentity } from "../domain/auth-identity";
import type { AppointmentRecord, AppointmentStatus } from "../domain/appointment";
import { calculateAvailability, utcToLocalDateAndMinute } from "../domain/availability";
import type { TenantContext } from "../domain/tenant-context";
import type { ServiceRecord } from "../domain/service";
import type { StaffRecord } from "../domain/staff";
import type { WorkingHoursRecord } from "../domain/working-hours";

export type BookingDataRepository = Readonly<{
  getBookingContext(tenantContext: TenantContext, input: Readonly<{ serviceId: string; staffId: string }>): Promise<Readonly<{
    service: ServiceRecord; staff: StaffRecord; workingHours: ReadonlyArray<WorkingHoursRecord>;
    appointments: ReadonlyArray<AppointmentRecord>; timezone: string;
  }> | null>;
  createAppointment(tenantContext: TenantContext, input: Readonly<{
    staffId: string; serviceId: string; customerProfileId: string; startAt: Date; endAt: Date;
  }>): Promise<"created" | "conflict" | "invalid_resource" | "persistence_failure">;
  transition(tenantContext: TenantContext, appointmentId: string, expectedFrom: AppointmentStatus, to: AppointmentStatus):
    Promise<"updated" | "not_found" | "invalid_transition" | "persistence_failure">;
}>;

export type BookingAuthorizer = Readonly<{
  authorize(identity: ApplicationIdentity, tenantContext: TenantContext, role: "TENANT_ADMIN" | "STAFF" | "CUSTOMER"): Promise<boolean>;
  authorizeStaffDecision(identity: ApplicationIdentity, tenantContext: TenantContext, appointment: AppointmentRecord): Promise<boolean>;
}>;

export function createBookingEngine(dependencies: Readonly<{ repository: BookingDataRepository; authorizer: BookingAuthorizer }>) {
  return {
    async availability(identity: ApplicationIdentity, tenantContext: TenantContext, input: Readonly<{ serviceId: string; staffId: string; dateIso: string }>) {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "CUSTOMER"))) return { status: "UNAUTHORIZED" as const, slots: [] };
      const context = await dependencies.repository.getBookingContext(tenantContext, input);
      if (!context || !context.service.active || context.staff.status !== "ACTIVE") return { status: "NOT_FOUND" as const, slots: [] };
      try {
        return { status: "ok" as const, slots: calculateAvailability({
          dateIso: input.dateIso, timeZone: context.timezone, workingHours: context.workingHours, staffId: context.staff.id,
          appointments: context.appointments, durationMinutes: context.service.durationMinutes, bufferMinutes: context.service.bufferMinutes, now: new Date(),
        }) };
      } catch { return { status: "INVALID_INPUT" as const, slots: [] }; }
    },

    async create(identity: ApplicationIdentity, tenantContext: TenantContext, input: Readonly<{
      serviceId: string; staffId: string; customerProfileId: string; startAt: Date;
    }>) {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "CUSTOMER"))) return { status: "UNAUTHORIZED" as const };
      if (!(input.startAt instanceof Date) || Number.isNaN(input.startAt.getTime()) || !input.customerProfileId) return { status: "INVALID_INPUT" as const };
      const context = await dependencies.repository.getBookingContext(tenantContext, input);
      if (!context || !context.service.active || context.staff.status !== "ACTIVE") return { status: "INVALID_RESOURCE" as const };
      const endAt = new Date(input.startAt.getTime() + (context.service.durationMinutes + context.service.bufferMinutes) * 60_000);
      let dateIso: string;
      try { dateIso = utcToLocalDateAndMinute(input.startAt, context.timezone).dateIso; } catch { return { status: "INVALID_INPUT" as const }; }
      const available = calculateAvailability({
        dateIso, timeZone: context.timezone, workingHours: context.workingHours, staffId: context.staff.id,
        appointments: context.appointments, durationMinutes: context.service.durationMinutes, bufferMinutes: context.service.bufferMinutes,
      }).some((slot) => slot.startAt.getTime() === input.startAt.getTime());
      if (!available) return { status: "SLOT_UNAVAILABLE" as const };
      const result = await dependencies.repository.createAppointment(tenantContext, { ...input, endAt });
      if (result === "created") return { status: "created" as const };
      if (result === "conflict") return { status: "SLOT_UNAVAILABLE" as const };
      if (result === "invalid_resource") return { status: "INVALID_RESOURCE" as const };
      return { status: "PERSISTENCE_FAILURE" as const };
    },

    async transition(identity: ApplicationIdentity, tenantContext: TenantContext, appointment: AppointmentRecord, to: AppointmentStatus) {
      const authorized = to === "CONFIRMED" || to === "REJECTED"
        ? await dependencies.authorizer.authorizeStaffDecision(identity, tenantContext, appointment)
        : await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN");
      if (!authorized) return { status: "UNAUTHORIZED" as const };
      const result = await dependencies.repository.transition(tenantContext, appointment.id, appointment.status, to);
      if (result === "updated") return { status: "updated" as const };
      if (result === "not_found") return { status: "NOT_FOUND" as const };
      if (result === "invalid_transition") return { status: "INVALID_TRANSITION" as const };
      return { status: "PERSISTENCE_FAILURE" as const };
    },
  };
}
