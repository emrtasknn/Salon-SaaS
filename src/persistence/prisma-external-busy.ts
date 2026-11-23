import { BUSY_TRUST_MS } from "../domain/google-calendar-sync";
import type { TenantContext } from "../domain/tenant-context";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

// ADR-045: busy time from phone calendars, read inside an existing tenant-context transaction.
// Two sources:
//  - phase B, Google: ExternalBusyBlock of a live connection that synced recently (a failing
//    sync must not keep closing online booking on stale data);
//  - phase C, RandevuN CalDAV account: PhoneCalendarEvent the user created on the phone, while
//    the account is live and the event blocks time (not all-day, not marked "free").

type FindMany<Select, Row> = {
  findMany(args: { where: Record<string, unknown>; select: Select; orderBy: { startAt: "asc" }; take?: number }): Promise<Row[]>;
};

export type ExternalBusyReadTransaction = {
  externalBusyBlock: FindMany<{ startAt: true; endAt: true }, { startAt: Date; endAt: Date }>;
  phoneCalendarEvent: FindMany<{ startAt: true; endAt: true }, { startAt: Date; endAt: Date }>;
};

function overlap(from: Date, to: Date) {
  return { startAt: { lt: to }, endAt: { gt: from } };
}

const trustedConnection = (now: Date) => ({ status: "ACTIVE", lastSyncAt: { gte: new Date(now.getTime() - BUSY_TRUST_MS) } });

/** Busy intervals of one staff member (online availability and the booking re-check). */
export async function readTrustedBusy(tx: ExternalBusyReadTransaction, input: { tenantId: string; staffId: string; from: Date; to: Date; now: Date }) {
  const google = await tx.externalBusyBlock.findMany({
    where: { tenantId: input.tenantId, staffId: input.staffId, ...overlap(input.from, input.to), connection: trustedConnection(input.now) },
    select: { startAt: true, endAt: true },
    orderBy: { startAt: "asc" },
  });
  const phone = await tx.phoneCalendarEvent.findMany({
    where: { tenantId: input.tenantId, staffId: input.staffId, blocksTime: true, ...overlap(input.from, input.to), account: { revokedAt: null } },
    select: { startAt: true, endAt: true },
    orderBy: { startAt: "asc" },
  });
  return [...google, ...phone].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export type BusyBlockView = Readonly<{ id: string; staffId: string; startAt: Date; endAt: Date; title: string | null }>;

type BusyListTransaction = PrismaTenantTransactionClient & {
  externalBusyBlock: FindMany<{ id: true; staffId: true; startAt: true; endAt: true }, { id: string; staffId: string; startAt: Date; endAt: Date }>;
  phoneCalendarEvent: FindMany<
    { id: true; staffId: true; startAt: true; endAt: true; title: true },
    { id: string; staffId: string | null; startAt: Date; endAt: Date; title: string | null }
  >;
};

/**
 * Busy time for the calendar screens: one staff member's (staff view) or the whole tenant's
 * (admin view). Phone events keep their title (owner decision 2026-11-20); Google gives none.
 */
export function listTrustedBusyBlocks(
  prisma: PrismaTenantClient,
  tenantContext: TenantContext,
  input: { staffId: string | null; from: Date; to: Date; now: Date },
): Promise<BusyBlockView[]> {
  const tenantId = tenantContext.tenantId;
  const staffFilter = input.staffId ? { staffId: input.staffId } : {};
  return withPrismaTenantContext(prisma, tenantContext, async (tx: BusyListTransaction) => {
    const google = await tx.externalBusyBlock.findMany({
      where: { tenantId, ...staffFilter, ...overlap(input.from, input.to), connection: trustedConnection(input.now) },
      select: { id: true, staffId: true, startAt: true, endAt: true },
      orderBy: { startAt: "asc" },
      take: 2000,
    });
    const phone = await tx.phoneCalendarEvent.findMany({
      // Events of an admin without a staff row have no staff column to sit in.
      where: { tenantId, ...(input.staffId ? { staffId: input.staffId } : { staffId: { not: null } }), ...overlap(input.from, input.to), account: { revokedAt: null } },
      select: { id: true, staffId: true, startAt: true, endAt: true, title: true },
      orderBy: { startAt: "asc" },
      take: 2000,
    });
    return [
      ...google.map((b) => ({ ...b, title: null })),
      ...phone.flatMap((e) => (e.staffId ? [{ id: `p-${e.id}`, staffId: e.staffId, startAt: e.startAt, endAt: e.endAt, title: e.title }] : [])),
    ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  });
}
