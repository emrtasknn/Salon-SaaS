import { appointmentServiceLabel } from "../domain/multi-service";
import type { StaffAppointmentsRepository } from "../application/staff-appointments";
import type { AppointmentRecord } from "../domain/appointment";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";
import { toBookingContact } from "../domain/appointment-contact";

type ContactRow = { displayName: string; phone: string | null; email: string | null; whatsappOptIn: boolean; optOutAt: Date | null };
const contactSelect = { displayName: true, phone: true, email: true, whatsappOptIn: true, optOutAt: true } as const;
const listInclude = {
  contact: { select: contactSelect },
  service: { select: { name: true } },
  // Multi-service list (owner decision 2026-11-06); empty for single-service appointments.
  services: { orderBy: { position: "asc" }, select: { service: { select: { name: true } } } },
  customerProfile: { select: { displayName: true } },
} as const;
type ListRow = AppointmentRecord & {
  contact: ContactRow | null; service: { name: string }; services?: Array<{ service: { name: string } }>; customerProfile: { displayName: string };
};

type Tx = PrismaTenantTransactionClient & {
  appointment: {
    findMany(args: { where: Record<string, unknown>; orderBy: Record<string, unknown>; include: typeof listInclude }): Promise<ListRow[]>;
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<AppointmentRecord | null>;
  };
  staff: {
    findUnique(args: { where: { tenantId_profileId: { tenantId: string; profileId: string } } }): Promise<{ id: string; tenantId: string; profileId: string; status: "ACTIVE" | "INACTIVE" } | null>;
  };
};

export function createPrismaStaffAppointmentsRepository(prisma: PrismaTenantClient): StaffAppointmentsRepository {
  return {
    async listForStaff(tenantContext, staffId, range) {
      const rows = await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
        tx.appointment.findMany({
          where: {
            tenantId: tenantContext.tenantId,
            staffId,
            startAt: { lt: range.endAt },
            endAt: { gt: range.startAt },
          },
          orderBy: { startAt: "asc" },
          include: listInclude,
        }),
      );
      // Only the snapshot fields leave persistence (no notice/opt-in evidence columns).
      return rows.map(({ contact, service, services, customerProfile, ...appointment }) => ({
        ...appointment,
        bookingContact: toBookingContact(contact),
        serviceName: appointmentServiceLabel(service.name, services?.map((item) => item.service.name)),
        customerName: customerProfile.displayName,
      }));
    },
    async findById(tenantContext, appointmentId) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
        tx.appointment.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: appointmentId } } }),
      );
    },
  };
}
