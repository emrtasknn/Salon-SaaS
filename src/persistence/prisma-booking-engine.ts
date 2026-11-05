import type { BookingDataRepository } from "../application/booking-engine";
import type { AppointmentRecord, AppointmentStatus } from "../domain/appointment";
import type { ServiceRecord } from "../domain/service";
import type { StaffRecord } from "../domain/staff";
import type { TenantStatus } from "../domain/tenant";
import type { WorkingHoursRecord } from "../domain/working-hours";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";
import { transitionAppointmentStatus } from "../domain/appointment";
import { appointmentAccessTokenExpiry } from "../domain/appointment-access-token";
import { addDaysToDateIso, calculateAvailability, isSlotOnClosedDate, localDayUtcRange, utcToLocalDateAndMinute } from "../domain/availability";
import { closureDateFromDb, closureDateToDb } from "../domain/closure-date";
import { readTenantStatusForShare, type TenantStatusQueryTransaction } from "./tenant-status-guard";
import { STAFF_VERBAL_OPTIN, staffVerbalOptInHash } from "../domain/legal-notice";
import { normalizeE164Phone } from "../domain/tenant";

type ProfileRow = { id: string; displayName: string; email: string | null; phone: string | null };

export type ClosureDateReadTransaction = {
  closureDate: {
    findMany(args: {
      where: { tenantId: string; date: { in: Date[] }; OR: Array<{ staffId: string | null }> };
      select: { date: true };
    }): Promise<Array<{ date: Date }>>;
  };
};

type Tx = PrismaTenantTransactionClient & TenantStatusQueryTransaction & ClosureDateReadTransaction & {
  tenant: { findUnique(args: { where: { id: string } }): Promise<{ id: string; timezone: string; status: TenantStatus } | null> };
  service: {
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<ServiceRecord | null>;
    findMany(args: { where: { tenantId: string; active: true }; orderBy: { name: "asc" }; select: { id: true; name: true; durationMinutes: true } }): Promise<Array<{ id: string; name: string; durationMinutes: number }>>;
  };
  staff: {
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<StaffRecord | null>;
    findMany(args: {
      where: { tenantId: string; status: "ACTIVE"; id?: string };
      select: { id: true; profile: { select: { displayName: true } } };
    }): Promise<Array<{ id: string; profile: { displayName: string } }>>;
  };
  workingHours: { findMany(args: { where: { tenantId: string }; orderBy: { dayOfWeek: "asc" } }): Promise<WorkingHoursRecord[]> };
  profile: {
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<ProfileRow | null>;
    findFirst(args: { where: { tenantId: string; email: { equals: string; mode: "insensitive" } } }): Promise<ProfileRow | null>;
    create(args: { data: { tenantId: string; displayName: string; email: string | null; phone: string | null } }): Promise<ProfileRow>;
  };
  appointment: {
    findMany(args: { where: { tenantId: string; staffId: string; startAt: { lt: Date }; endAt: { gt: Date } } }): Promise<AppointmentRecord[]>;
    create(args: { data: { tenantId: string; staffId: string; serviceId: string; customerProfileId: string; startAt: Date; endAt: Date; status: AppointmentStatus } }): Promise<{ id: string }>;
    updateMany(args: { where: { tenantId: string; id: string; status: AppointmentStatus }; data: { status: AppointmentStatus } }): Promise<{ count: number }>;
  };
  appointmentAccessToken: {
    create(args: { data: { tenantId: string; appointmentId: string; tokenHash: string; expiresAt: Date }; select: { id: true } }): Promise<{ id: string }>;
  };
  appointmentContact: {
    create(args: { data: {
      tenantId: string; appointmentId: string; source: "STAFF";
      displayName: string; email: string | null; phone: string | null;
      whatsappOptIn: boolean; optInVersion: string | null; optInHash: string | null; optInAt: Date | null;
      optInRecordedByProfileId: string | null;
    }; select: { id: true } }): Promise<{ id: string }>;
  };
};

// AppointmentContact column rules (see migration 20261106100000): name VARCHAR(160) non-blank,
// email shape, E.164 phone. Legacy profile values that do not fit are dropped from the snapshot.
const CONTACT_NAME_MAX = 160;
const CONTACT_EMAIL = /^[^@\s]+@[^@\s]+$/;

/** WP-10: contact snapshot of the customer as entered (guest) or as currently stored (existing profile). */
export function contactSnapshot(customer: ProfileRow): { displayName: string; email: string | null; phone: string | null } {
  const name = customer.displayName.trim().slice(0, CONTACT_NAME_MAX).trim();
  const email = customer.email?.trim() ?? "";
  const phone = normalizeE164Phone(customer.phone);
  return {
    displayName: name || "Müşteri",
    email: email && email.length <= 254 && CONTACT_EMAIL.test(email) ? email : null,
    phone: phone.ok ? phone.value : null,
  };
}

function activeConflict(status: AppointmentStatus): boolean {
  return status !== "CANCELLED" && status !== "REJECTED";
}

/**
 * WP-08: closed local dates (tenant-wide, or for this staff) among `dateIsos`.
 * Must run on the caller's tenant-context transaction: outside it RLS returns no rows (fail-open).
 */
export async function readClosedDates(
  tx: ClosureDateReadTransaction,
  tenantId: string,
  staffId: string,
  dateIsos: ReadonlyArray<string>,
): Promise<string[]> {
  const rows = await tx.closureDate.findMany({
    where: { tenantId, date: { in: [...new Set(dateIsos)].map(closureDateToDb) }, OR: [{ staffId: null }, { staffId }] },
    select: { date: true },
  });
  return [...new Set(rows.map((row) => closureDateFromDb(row.date)))];
}

export function createPrismaBookingRepository(prisma: PrismaTenantClient): BookingDataRepository {
  return {
    async getBookingContext(tenantContext, input) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const [tenant, service, staff, workingHours] = await Promise.all([
          tx.tenant.findUnique({ where: { id: tenantContext.tenantId } }),
          tx.service.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.serviceId } } }),
          tx.staff.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.staffId } } }),
          tx.workingHours.findMany({ where: { tenantId: tenantContext.tenantId }, orderBy: { dayOfWeek: "asc" } }),
        ]);
        if (!tenant || !service || !staff) return null;
        let dateIso: string;
        if (typeof input.dateIso === "string") dateIso = input.dateIso;
        else if (input.at instanceof Date) dateIso = utcToLocalDateAndMinute(input.at, tenant.timezone).dateIso;
        else throw new TypeError("Booking context day is missing");
        const nextDateIso = addDaysToDateIso(dateIso, 1);
        // Bounded to the local day plus the next one: a slot ending after midnight can overlap it.
        const dayStart = localDayUtcRange(dateIso, tenant.timezone).startAt;
        const windowEnd = localDayUtcRange(nextDateIso, tenant.timezone).endAt;
        const appointments = await tx.appointment.findMany({
          where: { tenantId: tenantContext.tenantId, staffId: input.staffId, startAt: { lt: windowEnd }, endAt: { gt: dayStart } },
        });
        const closedDates = await readClosedDates(tx, tenantContext.tenantId, input.staffId, [dateIso, nextDateIso]);
        return { service, staff, workingHours, appointments, timezone: tenant.timezone, tenantStatus: tenant.status, dateIso, closedDates };
      });
    },

    async getCreateOptions(tenantContext, input) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const tenant = await tx.tenant.findUnique({ where: { id: tenantContext.tenantId } });
        if (!tenant) return null;
        const [services, staff] = await Promise.all([
          tx.service.findMany({ where: { tenantId: tenantContext.tenantId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, durationMinutes: true } }),
          tx.staff.findMany({
            where: { tenantId: tenantContext.tenantId, status: "ACTIVE", ...(input.staffId ? { id: input.staffId } : {}) },
            select: { id: true, profile: { select: { displayName: true } } },
          }),
        ]);
        return {
          timezone: tenant.timezone,
          services: services.map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes })),
          staff: staff
            .map((s) => ({ id: s.id, displayName: s.profile.displayName }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName, "tr")),
        };
      });
    },

    async createAppointment(tenantContext, input) {
      try {
        return await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
          const tenantId = tenantContext.tenantId;
          // Serialize booking attempts per tenant + staff, not per exact start time.
          // Different start times can still overlap when service durations differ.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ":" + input.staffId}, 0))`;
          // WP-07: tenant status gate (FOR SHARE) before any conflict check or insert.
          const tenantStatus = await readTenantStatusForShare(tx, tenantId);
          if (tenantStatus === null) return "invalid_resource";
          if (tenantStatus !== "ACTIVE") return "tenant_inactive";
          const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
          if (!tenant) return "invalid_resource";
          // WP-08: closure read AFTER the FOR SHARE read. Closure creation takes Tenant FOR UPDATE,
          // so a closure committed before this point is visible here and a later one waits for us.
          const startDateIso = utcToLocalDateAndMinute(input.startAt, tenant.timezone).dateIso;
          const closedDates = await readClosedDates(tx, tenantId, input.staffId, [startDateIso, addDaysToDateIso(startDateIso, 1)]);
          const [service, staff, workingHours] = await Promise.all([
            tx.service.findUnique({ where: { tenantId_id: { tenantId, id: input.serviceId } } }),
            tx.staff.findUnique({ where: { tenantId_id: { tenantId, id: input.staffId } } }),
            tx.workingHours.findMany({ where: { tenantId }, orderBy: { dayOfWeek: "asc" } }),
          ]);
          if (!service || !staff || !service.active || staff.status !== "ACTIVE") return "invalid_resource";
          const endAt = new Date(input.startAt.getTime() + (service.durationMinutes + service.bufferMinutes) * 60_000);
          if (isSlotOnClosedDate({ startAt: input.startAt, endAt }, tenant.timezone, closedDates)) return "closed_date";
          // WP-08: working hours re-checked in the transaction (same rule as public booking).
          const slot = calculateAvailability({
            dateIso: startDateIso, timeZone: tenant.timezone, workingHours, staffId: input.staffId, appointments: [],
            durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes, now: new Date(), closedDates,
          }).find((candidate) => candidate.startAt.getTime() === input.startAt.getTime());
          if (!slot) return "slot_unavailable";
          const conflicts = await tx.appointment.findMany({ where: {
            tenantId, staffId: input.staffId, startAt: { lt: endAt }, endAt: { gt: input.startAt },
          }});
          if (conflicts.some((a) => activeConflict(a.status))) return "conflict";

          let customer: ProfileRow;
          if (input.customer.kind === "existing") {
            const existing = await tx.profile.findUnique({ where: { tenantId_id: { tenantId, id: input.customer.profileId } } });
            if (!existing) return "customer_not_found";
            // WP-10: checked before any write (a returned value commits the tx).
            if (input.contact?.whatsappVerbalOptIn === true && contactSnapshot(existing).phone === null) return "opt_in_requires_phone";
            customer = existing;
          } else {
            // WP-10: same pre-write check for guests (guest phone is E.164-validated upstream).
            if (input.contact?.whatsappVerbalOptIn === true && !input.customer.phone) return "opt_in_requires_phone";
            if (input.customer.email) {
              // Never silently attach to an existing profile: the caller must choose it explicitly.
              const match = await tx.profile.findFirst({ where: { tenantId, email: { equals: input.customer.email, mode: "insensitive" } } });
              if (match) {
                return { status: "email_exists" as const, existing: { profileId: match.id, displayName: match.displayName, phone: match.phone, email: match.email } };
              }
            }
            customer = await tx.profile.create({ data: {
              tenantId, displayName: input.customer.displayName, email: input.customer.email, phone: input.customer.phone,
            } });
          }

          const appointment = await tx.appointment.create({ data: {
            tenantId, staffId: input.staffId, serviceId: input.serviceId, customerProfileId: customer.id,
            startAt: input.startAt, endAt, status: input.initialStatus,
          } });
          // WP-06 parity: status-link token row in the same tx; a failed insert rolls the booking back.
          await tx.appointmentAccessToken.create({
            data: { tenantId, appointmentId: appointment.id, tokenHash: input.accessTokenHash, expiresAt: appointmentAccessTokenExpiry(endAt) },
            select: { id: true },
          });
          // WP-10: contact snapshot in the same tx; staff-created bookings carry no notice record.
          const snapshot = contactSnapshot(customer);
          const requested = input.contact?.whatsappVerbalOptIn === true;
          const optIn = requested && snapshot.phone !== null;
          if (requested && !optIn) throw new Error("verbal opt-in without phone");
          await tx.appointmentContact.create({
            data: {
              tenantId, appointmentId: appointment.id, source: "STAFF", ...snapshot,
              whatsappOptIn: optIn,
              optInVersion: optIn ? STAFF_VERBAL_OPTIN.version : null,
              optInHash: optIn ? staffVerbalOptInHash() : null,
              optInAt: optIn ? new Date() : null,
              optInRecordedByProfileId: optIn ? input.contact?.recordedByProfileId ?? null : null,
            },
            select: { id: true },
          });
          return { status: "created" as const, appointmentId: appointment.id, customerWhatsAppOptIn: optIn };
        });
      } catch { return "persistence_failure"; }
    },

    async transition(tenantContext, appointmentId, expectedFrom, to) {
      try {
        transitionAppointmentStatus(expectedFrom, to);
        const result = await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) =>
          tx.appointment.updateMany({ where: { tenantId: tenantContext.tenantId, id: appointmentId, status: expectedFrom }, data: { status: to } }),
        );
        return result.count === 1 ? "updated" : "invalid_transition";
      } catch (error) {
        return error instanceof TypeError ? "invalid_transition" : "persistence_failure";
      }
    },
  };
}
