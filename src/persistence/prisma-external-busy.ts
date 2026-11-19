import { BUSY_TRUST_MS } from "../domain/google-calendar-sync";

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
