import type { CalDavRepository, DavAccount, StoredPhoneEvent } from "../application/caldav-service";
import type { TenantContext } from "../domain/tenant-context";
import { createPrismaCalendarFeedRepository } from "./prisma-calendar-feed";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

// ADR-045 phase C persistence: RandevuN CalDAV accounts and the events phones create in them.
// Every query runs inside withPrismaTenantContext (RLS app.tenant_id) and filters on the trusted
// tenantId; queries in one transaction run one after another.

type Where = Record<string, unknown>;

type PhoneTx = PrismaTenantTransactionClient & {
  phoneCalendarAccount: {
    findFirst(args: { where: Where; select: Record<string, true> }): Promise<
      (DavAccount & { createdAt: Date }) | null
    >;
    updateMany(args: { where: Where; data: Where }): Promise<{ count: number }>;
    create(args: { data: Where }): Promise<unknown>;
  };
  phoneCalendarEvent: {
    findMany(args: { where: Where; select: Record<string, true>; orderBy?: Where; take?: number }): Promise<StoredPhoneEvent[]>;
    upsert(args: { where: Where; create: Where; update: Where }): Promise<unknown>;
    deleteMany(args: { where: Where }): Promise<{ count: number }>;
  };
};

const accountSelect = { id: true, profileId: true, username: true, passwordHash: true, lastSeenAt: true, createdAt: true } as const;
/** A busy salon account keeps a few hundred phone events; this caps one listing. */
const MAX_EVENTS = 3000;

export type PhoneAccountStatus = Readonly<{ active: boolean; username: string | null; createdAt: Date | null; lastSeenAt: Date | null }>;

export function createPrismaPhoneCalendarRepository(prisma: PrismaTenantClient): CalDavRepository & {
  issue(tenantContext: TenantContext, input: { profileId: string; username: string; passwordHash: string; now: Date }): Promise<void>;
  revoke(tenantContext: TenantContext, input: { profileId: string; now: Date }): Promise<void>;
  status(tenantContext: TenantContext, profileId: string): Promise<PhoneAccountStatus>;
} {
  const feed = createPrismaCalendarFeedRepository(prisma);
  const run = <T>(tenantContext: TenantContext, op: (tx: PhoneTx) => Promise<T>) => withPrismaTenantContext(prisma, tenantContext, op);

  return {
    readHolder: feed.readHolder,
    listAppointments: feed.listAppointments,

    async findLiveAccount(tenantContext, username) {
      const tenantId = tenantContext.tenantId;
      const row = await run(tenantContext, (tx) =>
        tx.phoneCalendarAccount.findFirst({ where: { tenantId, username, revokedAt: null }, select: accountSelect }),
      );
      return row ? { id: row.id, profileId: row.profileId, username: row.username, passwordHash: row.passwordHash, lastSeenAt: row.lastSeenAt } : null;
    },

    async touchAccount(tenantContext, accountId, now) {
      const tenantId = tenantContext.tenantId;
      await run(tenantContext, (tx) => tx.phoneCalendarAccount.updateMany({ where: { tenantId, id: accountId }, data: { lastSeenAt: now } }));
    },

    async listEvents(tenantContext, accountId) {
      const tenantId = tenantContext.tenantId;
      return run(tenantContext, (tx) =>
        tx.phoneCalendarEvent.findMany({
          where: { tenantId, accountId },
          select: { href: true, etag: true, ics: true, startAt: true, endAt: true },
          orderBy: { startAt: "desc" },
          take: MAX_EVENTS,
        }),
      );
    },

    async saveEvent(tenantContext, input) {
      const tenantId = tenantContext.tenantId;
      const data = {
        staffId: input.staffId, uid: input.uid, etag: input.etag, ics: input.ics, title: input.title,
        startAt: input.startAt, endAt: input.endAt, blocksTime: input.blocksTime,
      };
      await run(tenantContext, (tx) =>
        tx.phoneCalendarEvent.upsert({
          where: { tenantId_accountId_href: { tenantId, accountId: input.accountId, href: input.href } },
          create: { tenantId, accountId: input.accountId, href: input.href, ...data },
          update: data,
        }),
      );
    },

    async deleteEvent(tenantContext, accountId, href) {
      const tenantId = tenantContext.tenantId;
      const { count } = await run(tenantContext, (tx) => tx.phoneCalendarEvent.deleteMany({ where: { tenantId, accountId, href } }));
      return count > 0;
    },

    async issue(tenantContext, { profileId, username, passwordHash, now }) {
      const tenantId = tenantContext.tenantId;
      await run(tenantContext, async (tx) => {
        // One live account per profile; the old one (and its phone sign-in) stops working.
        // Its events stay as history until the account row is cleaned up; they no longer block time.
        await tx.phoneCalendarAccount.updateMany({ where: { tenantId, profileId, revokedAt: null }, data: { revokedAt: now } });
        await tx.phoneCalendarAccount.create({ data: { tenantId, profileId, username, passwordHash } });
      });
    },

    async revoke(tenantContext, { profileId, now }) {
      const tenantId = tenantContext.tenantId;
      await run(tenantContext, (tx) => tx.phoneCalendarAccount.updateMany({ where: { tenantId, profileId, revokedAt: null }, data: { revokedAt: now } }));
    },

    async status(tenantContext, profileId) {
      const tenantId = tenantContext.tenantId;
      const row = await run(tenantContext, (tx) =>
        tx.phoneCalendarAccount.findFirst({ where: { tenantId, profileId, revokedAt: null }, select: accountSelect }),
      );
      return { active: row !== null, username: row?.username ?? null, createdAt: row?.createdAt ?? null, lastSeenAt: row?.lastSeenAt ?? null };
    },
  };
}
