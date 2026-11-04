import type { ClosureImpactAppointment, ClosureRepository } from "../application/closure-management";
import { localDayUtcRange } from "../domain/availability";
import { closureDateFromDb, closureDateToDb, isPastLocalDate } from "../domain/closure-date";
import { withPrismaTenantContext, type PrismaTenantClient, type PrismaTenantTransactionClient } from "./prisma-tenant-context";

// WP-08: every ClosureDate read/write runs on a withPrismaTenantContext transaction.
// Outside it RLS returns no rows, which would silently fail open for availability.

type ClosureRow = { id: string; date: Date; reason: string | null };
type ImpactRow = {
  id: string; startAt: Date; status: "PENDING" | "CONFIRMED";
  staff: { profile: { displayName: string } };
  customerProfile: { displayName: string };
};

type Tx = PrismaTenantTransactionClient & {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: readonly unknown[]): Promise<T>;
  tenant: { findUnique(args: { where: { id: string }; select: { timezone: true } }): Promise<{ timezone: string } | null> };
  closureDate: {
    findMany(args: {
      where: { tenantId: string; staffId: null; date: { gte: Date; lte: Date } };
      orderBy: { date: "asc" };
      select: { id: true; date: true; reason: true };
    }): Promise<ClosureRow[]>;
    findFirst(args: { where: { tenantId: string; staffId: null; date: Date }; select: { id: true } }): Promise<{ id: string } | null>;
    create(args: {
      data: { tenantId: string; staffId: null; date: Date; reason: string | null; createdByProfileId: string };
      select: { id: true; date: true; reason: true };
    }): Promise<ClosureRow>;
    deleteMany(args: { where: { tenantId: string; id: string; staffId: null } }): Promise<{ count: number }>;
  };
  appointment: {
    findMany(args: {
      where: { tenantId: string; status: { in: Array<"PENDING" | "CONFIRMED"> }; startAt: { lt: Date }; endAt: { gt: Date } };
      orderBy: { startAt: "asc" };
      select: {
        id: true; startAt: true; status: true;
        staff: { select: { profile: { select: { displayName: true } } } };
        customerProfile: { select: { displayName: true } };
      };
    }): Promise<ImpactRow[]>;
  };
};

function toRecord(row: ClosureRow) {
  return { id: row.id, date: closureDateFromDb(row.date), reason: row.reason };
}

/**
 * PENDING/CONFIRMED appointments that overlap the local day `dateIso` (tenant
 * timezone), including ones that start the evening before and run past
 * midnight. Matches the booking rule (start or endAt - 1ms on a closed date).
 */
async function readImpact(tx: Tx, tenantId: string, dateIso: string, timezone: string): Promise<ClosureImpactAppointment[]> {
  const range = localDayUtcRange(dateIso, timezone);
  const rows = await tx.appointment.findMany({
    where: { tenantId, status: { in: ["PENDING", "CONFIRMED"] }, startAt: { lt: range.endAt }, endAt: { gt: range.startAt } },
    orderBy: { startAt: "asc" },
    select: {
      id: true, startAt: true, status: true,
      staff: { select: { profile: { select: { displayName: true } } } },
      customerProfile: { select: { displayName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id, startAt: row.startAt, status: row.status,
    staffName: row.staff.profile.displayName, customerName: row.customerProfile.displayName,
  }));
}

export function createPrismaClosureDateRepository(prisma: PrismaTenantClient): ClosureRepository {
  return {
    async list(tenantContext, range) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantContext.tenantId }, select: { timezone: true } });
        if (!tenant) return null;
        const rows = await tx.closureDate.findMany({
          where: { tenantId: tenantContext.tenantId, staffId: null, date: { gte: closureDateToDb(range.from), lte: closureDateToDb(range.to) } },
          orderBy: { date: "asc" },
          select: { id: true, date: true, reason: true },
        });
        return { timezone: tenant.timezone, closures: rows.map(toRecord) };
      });
    },

    async impact(tenantContext, dateIso) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantContext.tenantId }, select: { timezone: true } });
        if (!tenant) return null;
        return { timezone: tenant.timezone, appointments: await readImpact(tx, tenantContext.tenantId, dateIso, tenant.timezone) };
      });
    },

    async create(tenantContext, input) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const tenantId = tenantContext.tenantId;
        // FOR UPDATE conflicts with the bookings' Tenant FOR SHARE: in-flight bookings finish first,
        // later bookings see this closure. It also serializes concurrent closure creates (one per date).
        const rows = await tx.$queryRaw<Array<{ timezone: unknown }>>`SELECT "timezone" FROM "Tenant" WHERE "id" = ${tenantId} FOR UPDATE`;
        const timezone = Array.isArray(rows) ? rows[0]?.timezone : undefined;
        if (typeof timezone !== "string") return "not_found" as const;
        if (isPastLocalDate(input.date, input.now, timezone)) return "past_date" as const;
        const date = closureDateToDb(input.date);
        const existing = await tx.closureDate.findFirst({ where: { tenantId, staffId: null, date }, select: { id: true } });
        if (existing) return "duplicate" as const;
        const appointments = await readImpact(tx, tenantId, input.date, timezone);
        if (appointments.length > 0 && !input.confirmExistingAppointments) {
          return { status: "has_appointments" as const, timezone, appointments };
        }
        const created = await tx.closureDate.create({
          data: { tenantId, staffId: null, date, reason: input.reason, createdByProfileId: input.createdByProfileId },
          select: { id: true, date: true, reason: true },
        });
        return { status: "created" as const, closure: toRecord(created) };
      });
    },

    async delete(tenantContext, closureId) {
      const result = await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
        tx.closureDate.deleteMany({ where: { tenantId: tenantContext.tenantId, id: closureId, staffId: null } }),
      );
      return result.count === 1 ? "deleted" : "not_found";
    },
  };
}
