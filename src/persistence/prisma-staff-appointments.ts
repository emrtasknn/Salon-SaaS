import type { StaffAppointmentsRepository } from "../application/staff-appointments";
import type { AppointmentRecord } from "../domain/appointment";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";
import { toBookingContact } from "../domain/appointment-contact";

type ContactRow = { displayName: string; phone: string | null; email: string | null; whatsappOptIn: boolean; optOutAt: Date | null };
const contactSelect = { displayName: true, phone: true, email: true, whatsappOptIn: true, optOutAt: true } as const;

type Tx = PrismaTenantTransactionClient & {
  appointment: {
    findMany(args: { where: Record<string, unknown>; orderBy: Record<string, unknown>; include: { contact: { select: typeof contactSelect } } }): Promise<Array<AppointmentRecord & { contact: ContactRow | null }>>;
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
          include: { contact: { select: contactSelect } },
        }),
      );
      // Only the snapshot fields leave persistence (no notice/opt-in evidence columns).
      return rows.map(({ contact, ...appointment }) => ({ ...appointment, bookingContact: toBookingContact(contact) }));
    },
    async findById(tenantContext, appointmentId) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
        tx.appointment.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: appointmentId } } }),
      );
    },
  };
}
