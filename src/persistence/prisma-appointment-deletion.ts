import type { AppointmentRecord } from "../domain/appointment";
import type { AppointmentDeletionRepository } from "../application/appointment-deletion";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

type TerminalStatus = "REJECTED" | "CANCELLED" | "COMPLETED";
const TERMINAL_STATUSES: TerminalStatus[] = ["REJECTED", "CANCELLED", "COMPLETED"];

type Tx = PrismaTenantTransactionClient & {
  appointment: {
    findFirst(args: { where: { tenantId: string; id: string; deletedAt: null } }): Promise<AppointmentRecord | null>;
    updateMany(args: {
      where: { tenantId: string; id: string; deletedAt: null; status: { in: TerminalStatus[] } };
      data: { deletedAt: Date };
    }): Promise<{ count: number }>;
  };
};

// Archive (soft delete): the row stays for history/RLS; reads filter `deletedAt: null`.
export function createPrismaAppointmentDeletionRepository(prisma: PrismaTenantClient): AppointmentDeletionRepository {
  return {
    async find(tenantContext, id) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
        tx.appointment.findFirst({ where: { tenantId: tenantContext.tenantId, id, deletedAt: null } }),
      );
    },

    async archive(tenantContext, id, at) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const tenantId = tenantContext.tenantId;
        // Status is part of the write so a concurrent status change cannot slip through.
        const updated = await tx.appointment.updateMany({
          where: { tenantId, id, deletedAt: null, status: { in: TERMINAL_STATUSES } },
          data: { deletedAt: at },
        });
        if (updated.count === 1) return "archived" as const;
        const current = await tx.appointment.findFirst({ where: { tenantId, id, deletedAt: null } });
        if (!current) return "not_found" as const;
        return TERMINAL_STATUSES.includes(current.status as TerminalStatus) ? "not_found" as const : "not_terminal" as const;
      });
    },
  };
}
