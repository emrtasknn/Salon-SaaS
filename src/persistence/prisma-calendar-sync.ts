import type { CalendarSyncRepository, StoredConnection } from "../application/calendar-sync";
import type { TenantContext } from "../domain/tenant-context";
import type { Interval } from "../domain/google-calendar-sync";
import { createPrismaCalendarFeedRepository } from "./prisma-calendar-feed";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

// ADR-045 phase B persistence. Every query runs inside withPrismaTenantContext (RLS app.tenant_id)
// and filters on the trusted tenantId. Queries in one transaction run one after another.

type Where = Record<string, unknown>;
type ConnectionRow = {
  id: string; profileId: string; status: "ACTIVE" | "ERROR" | "REVOKED"; refreshTokenEnc: string; calendarId: string;
  busyCalendarIds: string[]; accountEmail: string | null; lastSyncAt: Date | null; lastErrorCode: string | null;
};

type SyncTx = PrismaTenantTransactionClient & {
  calendarConnection: {
    findFirst(args: { where: Where; select: Record<string, true>; orderBy?: Where }): Promise<ConnectionRow | null>;
    findMany(args: { where: Where; select: Record<string, true>; orderBy: Where; take: number }): Promise<ConnectionRow[]>;
    create(args: { data: Where }): Promise<unknown>;
    updateMany(args: { where: Where; data: Where }): Promise<{ count: number }>;
  };
  calendarEventLink: {
    findMany(args: { where: Where; select: { appointmentId: true; externalEventId: true; syncedUpdatedAt: true } }): Promise<
      Array<{ appointmentId: string; externalEventId: string; syncedUpdatedAt: Date }>
    >;
    upsert(args: { where: Where; create: Where; update: Where }): Promise<unknown>;
    deleteMany(args: { where: Where }): Promise<{ count: number }>;
  };
  externalBusyBlock: {
    deleteMany(args: { where: Where }): Promise<{ count: number }>;
    createMany(args: { data: Where[] }): Promise<{ count: number }>;
    findMany(args: { where: Where; select: { startAt: true; endAt: true }; orderBy: Where }): Promise<Interval[]>;
  };
  staff: { findUnique(args: { where: Where; select: { profileId: true } }): Promise<{ profileId: string } | null> };
};

const connectionSelect = {
  id: true, profileId: true, status: true, refreshTokenEnc: true, calendarId: true,
  busyCalendarIds: true, accountEmail: true, lastSyncAt: true, lastErrorCode: true,
} as const;

const toStored = (row: ConnectionRow): StoredConnection => ({ ...row, busyCalendarIds: row.busyCalendarIds ?? [] });

export function createPrismaCalendarSyncRepository(prisma: PrismaTenantClient): CalendarSyncRepository & {
  /** Busy blocks for online booking: only from live connections synced after `trustedSince`. */
  busyForStaff(tenantContext: TenantContext, input: { staffId: string; from: Date; to: Date; trustedSince: Date }): Promise<Interval[]>;
} {
  const feed = createPrismaCalendarFeedRepository(prisma);
  const run = <T>(tenantContext: TenantContext, op: (tx: SyncTx) => Promise<T>) => withPrismaTenantContext(prisma, tenantContext, op);

  return {
    readHolder: feed.readHolder,
    listAppointments: feed.listAppointments,

    async findLive(tenantContext, profileId) {
      const tenantId = tenantContext.tenantId;
      const row = await run(tenantContext, (tx) =>
        tx.calendarConnection.findFirst({ where: { tenantId, profileId, provider: "GOOGLE", status: { not: "REVOKED" } }, select: connectionSelect }),
      );
      return row ? toStored(row) : null;
    },

    async findLiveForStaff(tenantContext, staffId) {
      const tenantId = tenantContext.tenantId;
      const row = await run(tenantContext, async (tx) => {
        const staff = await tx.staff.findUnique({ where: { tenantId_id: { tenantId, id: staffId } }, select: { profileId: true } });
        if (!staff) return null;
        return tx.calendarConnection.findFirst({ where: { tenantId, profileId: staff.profileId, provider: "GOOGLE", status: { not: "REVOKED" } }, select: connectionSelect });
      });
      return row ? toStored(row) : null;
    },

    async listStale(tenantContext, olderThan, limit) {
      const tenantId = tenantContext.tenantId;
      const rows = await run(tenantContext, (tx) =>
        tx.calendarConnection.findMany({
          where: { tenantId, provider: "GOOGLE", status: "ACTIVE", OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: olderThan } }] },
          select: connectionSelect,
          orderBy: { lastSyncAt: { sort: "asc", nulls: "first" } },
          take: limit,
        }),
      );
      return rows.map(toStored);
    },

    async create(tenantContext, input) {
      const tenantId = tenantContext.tenantId;
      await run(tenantContext, async (tx) => {
        // One live connection per profile: a reconnect replaces the old one.
        await tx.calendarConnection.updateMany({
          where: { tenantId, profileId: input.profileId, provider: "GOOGLE", status: { not: "REVOKED" } },
          data: { status: "REVOKED", revokedAt: new Date() },
        });
        await tx.calendarConnection.create({
          data: { tenantId, profileId: input.profileId, provider: "GOOGLE", refreshTokenEnc: input.refreshTokenEnc, calendarId: input.calendarId, accountEmail: input.accountEmail },
        });
      });
    },

    async revoke(tenantContext, connectionId, now) {
      const tenantId = tenantContext.tenantId;
      await run(tenantContext, async (tx) => {
        await tx.calendarConnection.updateMany({ where: { tenantId, id: connectionId }, data: { status: "REVOKED", revokedAt: now } });
        // Busy time from a disconnected calendar must stop affecting online booking at once.
        await tx.externalBusyBlock.deleteMany({ where: { tenantId, connectionId } });
      });
    },

    async markSynced(tenantContext, connectionId, { now, errorCode, status }) {
      const tenantId = tenantContext.tenantId;
      await run(tenantContext, async (tx) => {
        await tx.calendarConnection.updateMany({
          where: { tenantId, id: connectionId },
          data: { lastSyncAt: now, lastErrorCode: errorCode, status, ...(status === "REVOKED" ? { revokedAt: now } : {}) },
        });
        if (status === "REVOKED") await tx.externalBusyBlock.deleteMany({ where: { tenantId, connectionId } });
      });
    },

    async listLinks(tenantContext, connectionId, { from, to }) {
      const tenantId = tenantContext.tenantId;
      return run(tenantContext, (tx) =>
        tx.calendarEventLink.findMany({
          where: { tenantId, connectionId, appointment: { startAt: { gte: from, lt: to } } },
          select: { appointmentId: true, externalEventId: true, syncedUpdatedAt: true },
        }),
      );
    },

    async saveLink(tenantContext, connectionId, link) {
      const tenantId = tenantContext.tenantId;
      await run(tenantContext, (tx) =>
        tx.calendarEventLink.upsert({
          where: { tenantId_connectionId_appointmentId: { tenantId, connectionId, appointmentId: link.appointmentId } },
          create: { tenantId, connectionId, appointmentId: link.appointmentId, externalEventId: link.externalEventId, syncedUpdatedAt: link.syncedUpdatedAt },
          update: { externalEventId: link.externalEventId, syncedUpdatedAt: link.syncedUpdatedAt },
        }),
      );
    },

    async deleteLink(tenantContext, connectionId, appointmentId) {
      const tenantId = tenantContext.tenantId;
      await run(tenantContext, (tx) => tx.calendarEventLink.deleteMany({ where: { tenantId, connectionId, appointmentId } }));
    },

    async replaceBusy(tenantContext, { connectionId, staffId, from, to, blocks }) {
      const tenantId = tenantContext.tenantId;
      await run(tenantContext, async (tx) => {
        // Replace the whole window (plus anything that already ended) in one transaction.
        await tx.externalBusyBlock.deleteMany({ where: { tenantId, connectionId, OR: [{ endAt: { lte: from } }, { startAt: { lt: to }, endAt: { gt: from } }] } });
        if (blocks.length) {
          await tx.externalBusyBlock.createMany({
            data: blocks.map((block) => ({ tenantId, staffId, connectionId, startAt: block.startAt, endAt: block.endAt })),
          });
        }
      });
    },

    async busyForStaff(tenantContext, { staffId, from, to, trustedSince }) {
      const tenantId = tenantContext.tenantId;
      return run(tenantContext, (tx) =>
        tx.externalBusyBlock.findMany({
          where: {
            tenantId, staffId, startAt: { lt: to }, endAt: { gt: from },
            connection: { status: "ACTIVE", lastSyncAt: { gte: trustedSince } },
          },
          select: { startAt: true, endAt: true },
          orderBy: { startAt: "asc" },
        }),
      );
    },
  };
}
