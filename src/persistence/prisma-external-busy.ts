import { BUSY_TRUST_MS } from "../domain/google-calendar-sync";
import type { TenantContext } from "../domain/tenant-context";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

// ADR-045 phase B: busy time from a connected Google calendar, read inside an existing
// tenant-context transaction. Only blocks of a live connection that synced recently are trusted:
// a failing sync must not keep closing online booking on stale data.

export type ExternalBusyReadTransaction = {
  externalBusyBlock: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { startAt: true; endAt: true };
      orderBy: { startAt: "asc" };
    }): Promise<Array<{ startAt: Date; endAt: Date }>>;
  };
};

export function readTrustedBusy(tx: ExternalBusyReadTransaction, input: { tenantId: string; staffId: string; from: Date; to: Date; now: Date }) {
  return tx.externalBusyBlock.findMany({
    where: {
      tenantId: input.tenantId,
      staffId: input.staffId,
      startAt: { lt: input.to },
      endAt: { gt: input.from },
      connection: { status: "ACTIVE", lastSyncAt: { gte: new Date(input.now.getTime() - BUSY_TRUST_MS) } },
    },
    select: { startAt: true, endAt: true },
    orderBy: { startAt: "asc" },
  });
}

export type BusyBlockView = Readonly<{ id: string; staffId: string; startAt: Date; endAt: Date }>;

type BusyListTransaction = PrismaTenantTransactionClient & {
  externalBusyBlock: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true; staffId: true; startAt: true; endAt: true };
      orderBy: { startAt: "asc" };
      take: number;
    }): Promise<BusyBlockView[]>;
  };
};

/**
 * Busy time from connected phone calendars for the calendar screens: one staff member's
 * (staff view) or the whole tenant's (admin view). Same trust rule as online booking.
 */
export function listTrustedBusyBlocks(
  prisma: PrismaTenantClient,
  tenantContext: TenantContext,
  input: { staffId: string | null; from: Date; to: Date; now: Date },
): Promise<BusyBlockView[]> {
  const tenantId = tenantContext.tenantId;
  return withPrismaTenantContext(prisma, tenantContext, (tx: BusyListTransaction) =>
    tx.externalBusyBlock.findMany({
      where: {
        tenantId,
        ...(input.staffId ? { staffId: input.staffId } : {}),
        startAt: { lt: input.to },
        endAt: { gt: input.from },
        connection: { status: "ACTIVE", lastSyncAt: { gte: new Date(input.now.getTime() - BUSY_TRUST_MS) } },
      },
      select: { id: true, staffId: true, startAt: true, endAt: true },
      orderBy: { startAt: "asc" },
      take: 2000,
    }),
  );
}
