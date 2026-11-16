import type { StaffDeletionRepository } from "../application/staff-deletion";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type Tx = PrismaTenantTransactionClient & {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: readonly unknown[]): Promise<T>;
  staff: {
    findFirst(args: { where: { tenantId: string; id: string; deletedAt: null } }): Promise<{ id: string; profileId: string } | null>;
    update(args: { where: { tenantId_id: { tenantId: string; id: string } }; data: { deletedAt: Date; status: "INACTIVE" } }): Promise<unknown>;
  };
  tenantMembership: {
    findMany(args: { where: { tenantId: string; profileId: string } }): Promise<Array<{ role: string }>>;
    deleteMany(args: { where: { tenantId: string; profileId: string } }): Promise<unknown>;
  };
  appointment: {
    count(args: {
      where: { tenantId: string; staffId: string; status: { in: Array<"PENDING" | "CONFIRMED"> }; deletedAt: null };
    }): Promise<number>;
  };
  staffService: { deleteMany(args: { where: { tenantId: string; staffId: string } }): Promise<unknown> };
  pushSubscription: {
    updateMany(args: { where: { tenantId: string; profileId: string; revokedAt: null }; data: { revokedAt: Date } }): Promise<unknown>;
  };
  profile: { update(args: { where: { tenantId_id: { tenantId: string; id: string } }; data: { email: null } }): Promise<unknown> };
};

// Archive (soft delete): staff row stays for appointment history; access and contact data are removed.
export function createPrismaStaffDeletionRepository(prisma: PrismaTenantClient): StaffDeletionRepository {
  return {
    async archive(tenantContext, { staffId, actorProfileId, now }) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const tenantId = tenantContext.tenantId;
        // FOR NO KEY UPDATE conflicts with bookings' Tenant FOR SHARE: in-flight bookings finish first,
        // so the active-appointment count below (any start time) cannot miss a concurrent booking.
        await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${tenantId} FOR NO KEY UPDATE`;

        const staff = await tx.staff.findFirst({ where: { tenantId, id: staffId, deletedAt: null } });
        if (!staff) return "not_found" as const;
        if (staff.profileId === actorProfileId) return "is_self" as const;

        const memberships = await tx.tenantMembership.findMany({ where: { tenantId, profileId: staff.profileId } });
        if (memberships.some((m) => m.role !== "STAFF")) return "not_staff_role" as const;

        const count = await tx.appointment.count({
          where: { tenantId, staffId, status: { in: ["PENDING", "CONFIRMED"] }, deletedAt: null },
        });
        if (count > 0) return { status: "has_active_appointments" as const, count };

        await tx.staff.update({ where: { tenantId_id: { tenantId, id: staffId } }, data: { deletedAt: now, status: "INACTIVE" } });
        await tx.staffService.deleteMany({ where: { tenantId, staffId } });
        await tx.tenantMembership.deleteMany({ where: { tenantId, profileId: staff.profileId } });
        await tx.pushSubscription.updateMany({ where: { tenantId, profileId: staff.profileId, revokedAt: null }, data: { revokedAt: now } });
        await tx.profile.update({ where: { tenantId_id: { tenantId, id: staff.profileId } }, data: { email: null } });
        return "archived" as const;
      });
    },
  };
}
