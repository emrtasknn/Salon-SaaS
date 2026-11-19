import type { CalendarFeedRepository } from "../application/calendar-feed";
import { FEED_STATUSES, type CalendarFeedScope, type FeedAppointment } from "../domain/calendar-feed";
import { appointmentServiceLabel } from "../domain/multi-service";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

// ADR-045 CalendarFeedToken access. Every query runs inside withPrismaTenantContext (RLS
// app.tenant_id) and also filters on the trusted tenantId (defence in depth). Queries inside one
// interactive transaction run one after another (they share a connection).

type Where = Record<string, unknown>;
type Row<T> = Promise<T>;

type FeedTx = PrismaTenantTransactionClient & {
  calendarFeedToken: {
    updateMany(args: { where: Where; data: Where }): Row<{ count: number }>;
    create(args: { data: Where }): Row<unknown>;
    findFirst(args: { where: Where; select: Record<string, true>; orderBy?: Where }): Row<
      { id: string; profileId: string; scope: CalendarFeedScope; lastUsedAt: Date | null; createdAt: Date } | null
    >;
    update(args: { where: Where; data: Where }): Row<unknown>;
  };
  tenantMembership: PrismaTenantTransactionClient["tenantMembership"] & {
    findFirst(args: { where: Where; select: { role: true } }): Row<{ role: "SUPER_ADMIN" | "TENANT_ADMIN" | "STAFF" | "CUSTOMER" } | null>;
  };
  staff: {
    findUnique(args: { where: Where; select: { id: true; status: true } }): Row<{ id: string; status: "ACTIVE" | "INACTIVE" } | null>;
    findMany(args: { where: Where; select: { id: true; profileId: true } }): Row<Array<{ id: string; profileId: string }>>;
  };
  appointment: {
    findMany(args: { where: Where; orderBy: Where; take: number; select: Record<string, true> }): Row<
      Array<{ id: string; startAt: Date; endAt: Date; status: string; updatedAt: Date; serviceId: string; staffId: string; customerProfileId: string }>
    >;
  };
  appointmentService: {
    findMany(args: { where: Where; orderBy: Where; select: { appointmentId: true; service: { select: { name: true } } } }): Row<
      Array<{ appointmentId: string; service: { name: string } }>
    >;
  };
  appointmentContact: {
    findMany(args: { where: Where; select: { appointmentId: true; displayName: true } }): Row<Array<{ appointmentId: string; displayName: string }>>;
  };
  service: { findMany(args: { where: Where; select: { id: true; name: true } }): Row<Array<{ id: string; name: string }>> };
  profile: { findMany(args: { where: Where; select: { id: true; displayName: true } }): Row<Array<{ id: string; displayName: string }>> };
};

/** Upper bound of events in one feed (a busy salon: ~40/day over 210 days stays below it). */
const MAX_FEED_EVENTS = 5000;

export function createPrismaCalendarFeedRepository(prisma: PrismaTenantClient): CalendarFeedRepository {
  return {
    async replace(tenantContext, { profileId, scope, tokenHash, now }) {
      const tenantId = tenantContext.tenantId;
      await withPrismaTenantContext(prisma, tenantContext, async (tx: FeedTx) => {
        await tx.calendarFeedToken.updateMany({ where: { tenantId, profileId, scope, revokedAt: null }, data: { revokedAt: now } });
        await tx.calendarFeedToken.create({ data: { tenantId, profileId, scope, tokenHash } });
      });
    },

    async revoke(tenantContext, { profileId, scope, now }) {
      const tenantId = tenantContext.tenantId;
      await withPrismaTenantContext(prisma, tenantContext, (tx: FeedTx) =>
        tx.calendarFeedToken.updateMany({ where: { tenantId, profileId, scope, revokedAt: null }, data: { revokedAt: now } }),
      );
    },

    async status(tenantContext, { profileId, scope }) {
      const tenantId = tenantContext.tenantId;
      const row = await withPrismaTenantContext(prisma, tenantContext, (tx: FeedTx) =>
        tx.calendarFeedToken.findFirst({
          where: { tenantId, profileId, scope, revokedAt: null },
          select: { id: true, profileId: true, scope: true, lastUsedAt: true, createdAt: true },
        }),
      );
      return { active: row !== null, createdAt: row?.createdAt ?? null, lastUsedAt: row?.lastUsedAt ?? null };
    },

    async findActiveByHash(tenantContext, tokenHash) {
      const tenantId = tenantContext.tenantId;
      const row = await withPrismaTenantContext(prisma, tenantContext, (tx: FeedTx) =>
        tx.calendarFeedToken.findFirst({
          where: { tenantId, tokenHash, revokedAt: null },
          select: { id: true, profileId: true, scope: true, lastUsedAt: true, createdAt: true },
        }),
      );
      return row ? { id: row.id, profileId: row.profileId, scope: row.scope, lastUsedAt: row.lastUsedAt } : null;
    },

    async readHolder(tenantContext, profileId) {
      const tenantId = tenantContext.tenantId;
      return withPrismaTenantContext(prisma, tenantContext, async (tx: FeedTx) => {
        const membership = await tx.tenantMembership.findFirst({ where: { tenantId, profileId }, select: { role: true } });
        const staff = await tx.staff.findUnique({ where: { tenantId_profileId: { tenantId, profileId } }, select: { id: true, status: true } });
        return { role: membership?.role ?? null, staffId: staff?.id ?? null, staffActive: staff?.status === "ACTIVE" };
      });
    },

    async listAppointments(tenantContext, { staffId, from, to }) {
      const tenantId = tenantContext.tenantId;
      return withPrismaTenantContext(prisma, tenantContext, async (tx: FeedTx): Promise<FeedAppointment[]> => {
        const rows = await tx.appointment.findMany({
          where: { tenantId, ...(staffId ? { staffId } : {}), status: { in: [...FEED_STATUSES] }, startAt: { gte: from, lt: to } },
          orderBy: { startAt: "asc" },
          take: MAX_FEED_EVENTS,
          select: { id: true, startAt: true, endAt: true, status: true, updatedAt: true, serviceId: true, staffId: true, customerProfileId: true },
        });
        if (rows.length === 0) return [];
        const ids = rows.map((row) => row.id);
        const multi = await tx.appointmentService.findMany({
          where: { tenantId, appointmentId: { in: ids } },
          orderBy: { position: "asc" },
          select: { appointmentId: true, service: { select: { name: true } } },
        });
        const contacts = await tx.appointmentContact.findMany({ where: { tenantId, appointmentId: { in: ids } }, select: { appointmentId: true, displayName: true } });
        const services = await tx.service.findMany({ where: { tenantId, id: { in: [...new Set(rows.map((r) => r.serviceId))] } }, select: { id: true, name: true } });
        const staff = await tx.staff.findMany({ where: { tenantId, id: { in: [...new Set(rows.map((r) => r.staffId))] } }, select: { id: true, profileId: true } });
        const profileIds = [...new Set([...rows.map((r) => r.customerProfileId), ...staff.map((s) => s.profileId)])];
        const profiles = await tx.profile.findMany({ where: { tenantId, id: { in: profileIds } }, select: { id: true, displayName: true } });

        const serviceName = new Map(services.map((s) => [s.id, s.name]));
        const profileName = new Map(profiles.map((p) => [p.id, p.displayName]));
        const staffName = new Map(staff.map((s) => [s.id, profileName.get(s.profileId) ?? ""]));
        const contactName = new Map(contacts.map((c) => [c.appointmentId, c.displayName]));
        const multiNames = new Map<string, string[]>();
        for (const entry of multi) multiNames.set(entry.appointmentId, [...(multiNames.get(entry.appointmentId) ?? []), entry.service.name]);

        return rows.map((row) => ({
          id: row.id,
          startAt: row.startAt,
          endAt: row.endAt,
          status: row.status,
          updatedAt: row.updatedAt,
          customerName: contactName.get(row.id) ?? profileName.get(row.customerProfileId) ?? "Müşteri",
          serviceLabel: appointmentServiceLabel(serviceName.get(row.serviceId) ?? "Hizmet", multiNames.get(row.id) ?? []),
          staffName: staffName.get(row.staffId) || null,
        }));
      });
    },

    async touch(tenantContext, tokenId, now) {
      const tenantId = tenantContext.tenantId;
      await withPrismaTenantContext(prisma, tenantContext, (tx: FeedTx) =>
        tx.calendarFeedToken.update({ where: { tenantId_id: { tenantId, id: tokenId } }, data: { lastUsedAt: now } }),
      );
    },
  };
}
