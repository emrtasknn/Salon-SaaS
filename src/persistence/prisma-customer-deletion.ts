import type { CustomerDeletionRepository } from "../application/customer-deletion";
import { DELETED_CUSTOMER_NAME } from "../domain/deletion";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: readonly unknown[]): Promise<T>;
  profile: {
    findFirst(args: { where: { tenantId: string; id: string; deletedAt: null } }): Promise<{ id: string } | null>;
    update(args: {
      where: { tenantId_id: { tenantId: string; id: string } };
      data: { deletedAt: Date; displayName: string; email: null; phone: null };
    }): Promise<unknown>;
  };
  staff: { findFirst(args: { where: { tenantId: string; profileId: string } }): Promise<{ id: string } | null> };
  tenantMembership: { count(args: { where: { tenantId: string; profileId: string } }): Promise<number> };
  appointment: {
    count(args: {
      where: { tenantId: string; customerProfileId: string; status: { in: Array<"PENDING" | "CONFIRMED"> }; startAt: { gt: Date }; deletedAt: null };
    }): Promise<number>;
  };
  customerNote: {
    deleteMany(args: { where: { tenantId: string; customerProfileId: string } | { tenantId: string; id: string } }): Promise<{ count: number }>;
  };
  appointmentContact: {
    updateMany(args: {
      where: { tenantId: string; appointment: { tenantId: string; customerProfileId: string } };
      data: { displayName: string; email: null; phone: null };
    }): Promise<unknown>;
  };
};

// Erasure (anonymization): the profile row stays so appointment history keeps working (placeholder name);
// personal data and notes are removed. Consent evidence on AppointmentContact is deliberately left untouched.
export function createPrismaCustomerDeletionRepository(prisma: PrismaTenantClient): CustomerDeletionRepository {
  return {
    async erase(tenantContext, { profileId, now }) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const tenantId = tenantContext.tenantId;
        // FOR UPDATE conflicts with bookings' Tenant FOR SHARE: in-flight bookings finish first,
        // so the active-appointment count below cannot miss a concurrent booking.
        await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;

        const profile = await tx.profile.findFirst({ where: { tenantId, id: profileId, deletedAt: null } });
        if (!profile) return "not_found" as const;

        const staff = await tx.staff.findFirst({ where: { tenantId, profileId } });
        const memberships = await tx.tenantMembership.count({ where: { tenantId, profileId } });
        if (staff || memberships > 0) return "not_customer" as const;

        const count = await tx.appointment.count({
          where: { tenantId, customerProfileId: profileId, status: { in: ["PENDING", "CONFIRMED"] }, startAt: { gt: now }, deletedAt: null },
        });
        if (count > 0) return { status: "has_active_appointments" as const, count };

        await tx.profile.update({
          where: { tenantId_id: { tenantId, id: profileId } },
          data: { deletedAt: now, displayName: DELETED_CUSTOMER_NAME, email: null, phone: null },
        });
        await tx.customerNote.deleteMany({ where: { tenantId, customerProfileId: profileId } });
        // All of the customer's appointments, archived included (no deletedAt filter).
        await tx.appointmentContact.updateMany({
          where: { tenantId, appointment: { tenantId, customerProfileId: profileId } },
          data: { displayName: DELETED_CUSTOMER_NAME, email: null, phone: null },
        });
        return "erased" as const;
      });
    },

    async deleteNote(tenantContext, noteId) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const result = await tx.customerNote.deleteMany({ where: { tenantId: tenantContext.tenantId, id: noteId } });
        return result.count > 0 ? ("deleted" as const) : ("not_found" as const);
      });
    },
  };
}
