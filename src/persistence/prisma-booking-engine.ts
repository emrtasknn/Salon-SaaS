import type { BookingDataRepository } from "../application/booking-engine";
import type { AppointmentRecord, AppointmentStatus } from "../domain/appointment";
import type { ServiceRecord } from "../domain/service";
import type { StaffRecord } from "../domain/staff";
import type { WorkingHoursRecord } from "../domain/working-hours";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";
import { transitionAppointmentStatus } from "../domain/appointment";

type Tx = PrismaTenantTransactionClient & {
  tenant: { findUnique(args: { where: { id: string } }): Promise<{ id: string; timezone: string } | null> };
  service: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<ServiceRecord | null> };
  staff: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<StaffRecord | null> };
  workingHours: { findMany(args: { where: { tenantId: string }; orderBy: { dayOfWeek: "asc" } }): Promise<WorkingHoursRecord[]> };
  appointment: {
    findMany(args: { where: { tenantId: string; staffId: string; startAt: { lt: Date }; endAt: { gt: Date } } }): Promise<AppointmentRecord[]>;
    create(args: { data: { tenantId: string; staffId: string; serviceId: string; customerProfileId: string; startAt: Date; endAt: Date; status: AppointmentStatus } }): Promise<AppointmentRecord>;
    updateMany(args: { where: { tenantId: string; id: string; status: AppointmentStatus }; data: { status: AppointmentStatus } }): Promise<{ count: number }>;
  };
};

function activeConflict(status: AppointmentStatus): boolean {
  return status !== "CANCELLED" && status !== "REJECTED";
}

export function createPrismaBookingRepository(prisma: PrismaTenantClient): BookingDataRepository {
  return {
    async getBookingContext(tenantContext, input) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const [tenant, service, staff, workingHours] = await Promise.all([
          tx.tenant.findUnique({ where: { id: tenantContext.tenantId } }),
          tx.service.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.serviceId } } }),
          tx.staff.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.staffId } } }),
          tx.workingHours.findMany({ where: { tenantId: tenantContext.tenantId }, orderBy: { dayOfWeek: "asc" } }),
        ]);
        if (!tenant || !service || !staff) return null;
        const appointments = await tx.appointment.findMany({
          where: { tenantId: tenantContext.tenantId, staffId: input.staffId, startAt: { lt: new Date("9999-12-31T23:59:59.999Z") }, endAt: { gt: new Date("1970-01-01T00:00:00.000Z") } },
        });
        return { service, staff, workingHours, appointments, timezone: tenant.timezone };
      });
    },

    async createAppointment(tenantContext, input) {
      try {
        return await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantContext.tenantId + ":" + input.staffId + ":" + input.startAt.toISOString()}, 0))`;
          const [service, staff] = await Promise.all([
            tx.service.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.serviceId } } }),
            tx.staff.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.staffId } } }),
          ]);
          if (!service || !staff || !service.active || staff.status !== "ACTIVE") return "invalid_resource";
          const conflicts = await tx.appointment.findMany({ where: {
            tenantId: tenantContext.tenantId, staffId: input.staffId, startAt: { lt: input.endAt }, endAt: { gt: input.startAt },
          }});
          if (conflicts.some((a) => activeConflict(a.status))) return "conflict";
          await tx.appointment.create({ data: { tenantId: tenantContext.tenantId, ...input, status: "PENDING" } });
          return "created";
        });
      } catch { return "persistence_failure"; }
    },

    async transition(tenantContext, appointmentId, expectedFrom, to) {
      try {
        transitionAppointmentStatus(expectedFrom, to);
        const result = await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
          tx.appointment.updateMany({ where: { tenantId: tenantContext.tenantId, id: appointmentId, status: expectedFrom }, data: { status: to } }),
        );
        return result.count === 1 ? "updated" : "invalid_transition";
      } catch (error) {
        return error instanceof TypeError ? "invalid_transition" : "persistence_failure";
      }
    },
  };
}
