import type { PublicBookingRepository } from "../application/public-booking";
import type { TenantContext } from "../domain/tenant-context";
import type { WorkingHoursRecord } from "../domain/working-hours";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";
import { addDaysToDateIso, calculateAvailability, isSlotOnClosedDate, utcToLocalDateAndMinute } from "../domain/availability";
import { appointmentAccessTokenExpiry } from "../domain/appointment-access-token";
import { readTenantStatusForShare, type TenantStatusQueryTransaction } from "./tenant-status-guard";
import { readClosedDates, type ClosureDateReadTransaction } from "./prisma-booking-engine";
import { staffServesService, type StaffServiceReadTransaction } from "./prisma-staff-services";
import { combineServiceTimings } from "../domain/multi-service";
import { CUSTOMER_NOTICE, WHATSAPP_OPTIN, customerNoticeHash, isLegalReady, whatsAppOptInHash } from "../domain/legal-notice";

type Tx = PrismaTenantTransactionClient & TenantStatusQueryTransaction & ClosureDateReadTransaction & StaffServiceReadTransaction & {
  tenant: { findUnique(args: { where: { id: string } }): Promise<{
    id: string; timezone: string; name: string; contactPhone: string | null;
    legalName: string | null; legalAddress: string | null; kvkkContactEmail: string | null;
  } | null> };
  service: {
    findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<{ id: string; durationMinutes: number; bufferMinutes: number; active: boolean } | null>;
    findMany(args: { where: { tenantId: string; id: { in: string[] } } }): Promise<Array<{ id: string; durationMinutes: number; bufferMinutes: number; active: boolean }>>;
  };
  appointmentService: {
    createMany(args: { data: Array<{ tenantId: string; appointmentId: string; serviceId: string; position: number }> }): Promise<{ count: number }>;
  };
  staff: { findUnique(args: { where: { tenantId_id: { tenantId: string; id: string } } }): Promise<{ id: string; status: "ACTIVE" | "INACTIVE" } | null> };
  workingHours: { findMany(args: { where: { tenantId: string }; orderBy: { dayOfWeek: "asc" } }): Promise<WorkingHoursRecord[]> };
  profile: {
    findUnique(args: { where: { tenantId_email: { tenantId: string; email: string } } }): Promise<{ id: string } | null>;
    create(args: { data: { tenantId: string; displayName: string; email: string; phone: string | null } }): Promise<{ id: string }>;
  };
  appointment: {
    findMany(args: { where: { tenantId: string; staffId: string; startAt: { lt: Date }; endAt: { gt: Date } } }): Promise<Array<{ id: string; tenantId: string; staffId: string; serviceId: string; customerProfileId: string; startAt: Date; endAt: Date; status: "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED" }>>;
    create(args: { data: { tenantId: string; staffId: string; serviceId: string; customerProfileId: string; startAt: Date; endAt: Date; status: "PENDING" } }): Promise<{ id: string }>;
  };
  appointmentAccessToken: {
    create(args: { data: { tenantId: string; appointmentId: string; tokenHash: string; expiresAt: Date }; select: { id: true } }): Promise<{ id: string }>;
  };
  appointmentContact: {
    create(args: { data: {
      tenantId: string; appointmentId: string; source: "PUBLIC_FORM";
      displayName: string; email: string; phone: string | null;
      noticeVersion: string; noticeHash: string; noticeShownAt: Date;
      whatsappOptIn: boolean; optInVersion: string | null; optInHash: string | null; optInAt: Date | null;
    }; select: { id: true } }): Promise<{ id: string }>;
  };
};

export function createPrismaPublicBookingRepository(prisma: PrismaTenantClient): PublicBookingRepository {
  return {
    async create(tenantContext: TenantContext, input) {
      try {
        return await withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
          // Serialize booking attempts per tenant + staff so overlapping start times cannot race.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantContext.tenantId + ":" + input.staffId}, 0))`;
          // WP-07: tenant status gate (FOR SHARE) before any conflict check or insert.
          const tenantStatus = await readTenantStatusForShare(tx, tenantContext.tenantId);
          if (tenantStatus === null) return "invalid_resource";
          if (tenantStatus !== "ACTIVE") return "tenant_inactive";
          const [tenant, service, staff, workingHours] = await Promise.all([
            tx.tenant.findUnique({ where: { id: tenantContext.tenantId } }),
            tx.service.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.serviceId } } }),
            tx.staff.findUnique({ where: { tenantId_id: { tenantId: tenantContext.tenantId, id: input.staffId } } }),
            tx.workingHours.findMany({ where: { tenantId: tenantContext.tenantId }, orderBy: { dayOfWeek: "asc" } }),
          ]);
          if (!tenant || !service || !staff || !service.active || staff.status !== "ACTIVE") return "invalid_resource";
          // Owner decision 2026-11-06: the staff member must perform every booked service (no mapping = every service).
          const extraIds = [...(input.extraServiceIds ?? [])];
          for (const serviceId of [input.serviceId, ...extraIds]) {
            if (!(await staffServesService(tx, tenantContext.tenantId, input.staffId, serviceId))) return "invalid_resource";
          }
          // Multi-service: extras must exist in this tenant and be active; time = sum of (duration + buffer).
          const extras = extraIds.length ? await tx.service.findMany({ where: { tenantId: tenantContext.tenantId, id: { in: extraIds } } }) : [];
          if (extras.length !== extraIds.length || extras.some((extra) => !extra.active)) return "invalid_resource";
          const timing = combineServiceTimings([service, ...extraIds.map((id) => extras.find((extra) => extra.id === id)!)]);
          // WP-10: legal fields re-checked on the row locked FOR SHARE above (a concurrent settings
          // update waits for this tx), so the recorded notice hash matches the text in force.
          if (!isLegalReady(tenant)) return "tenant_legal_incomplete";
          // WP-10: the texts the customer saw must equal the texts in force (same row, locked FOR SHARE).
          // Checked before any write: a returned value commits the tx.
          const noticeHash = customerNoticeHash(tenant);
          const optIn = input.whatsappOptIn === true;
          const optInHash = optIn ? whatsAppOptInHash(tenant) : null;
          if (input.shownNoticeHash !== noticeHash || (optIn && input.shownOptInHash !== optInHash)) return "notice_stale";
          const endAt = new Date(input.startAt.getTime() + (timing.durationMinutes + timing.bufferMinutes) * 60_000);
          const local = utcToLocalDateAndMinute(input.startAt, tenant.timezone);
          // WP-08: closure re-check AFTER the FOR SHARE tenant read, on this tenant-context tx (RLS).
          const closedDates = await readClosedDates(tx, tenantContext.tenantId, input.staffId, [local.dateIso, addDaysToDateIso(local.dateIso, 1)]);
          if (isSlotOnClosedDate({ startAt: input.startAt, endAt }, tenant.timezone, closedDates)) return "slot_unavailable";
          const slot = calculateAvailability({
            dateIso: local.dateIso,
            timeZone: tenant.timezone,
            workingHours,
            staffId: input.staffId,
            appointments: [],
            durationMinutes: timing.durationMinutes,
            bufferMinutes: timing.bufferMinutes,
            now: new Date(),
            closedDates,
          }).find((candidate) => candidate.startAt.getTime() === input.startAt.getTime());
          if (!slot) return "slot_unavailable";
          const conflicts = await tx.appointment.findMany({
            where: { tenantId: tenantContext.tenantId, staffId: input.staffId, startAt: { lt: endAt }, endAt: { gt: input.startAt } },
          });
          if (conflicts.some((a) => a.status !== "CANCELLED" && a.status !== "REJECTED")) return "slot_unavailable";
          // Profile is matched by (tenant, email) for CRM history only and is never updated from public
          // input; the contact data entered for this booking lives in AppointmentContact (WP-10).
          let profile = await tx.profile.findUnique({ where: { tenantId_email: { tenantId: tenantContext.tenantId, email: input.email } } });
          if (!profile) profile = await tx.profile.create({ data: { tenantId: tenantContext.tenantId, displayName: input.displayName, email: input.email, phone: input.phone } });
          const appointment = await tx.appointment.create({ data: { tenantId: tenantContext.tenantId, staffId: input.staffId, serviceId: input.serviceId, customerProfileId: profile.id, startAt: input.startAt, endAt, status: "PENDING" } });
          // Multi-service: the ordered list in the same tx (position 0 = serviceId). Single service: no rows.
          if (extraIds.length) {
            await tx.appointmentService.createMany({
              data: [input.serviceId, ...extraIds].map((serviceId, position) => ({ tenantId: tenantContext.tenantId, appointmentId: appointment.id, serviceId, position })),
            });
          }
          // WP-06: status-link token row in the same tx; a failed insert rolls the booking back.
          await tx.appointmentAccessToken.create({
            data: { tenantId: tenantContext.tenantId, appointmentId: appointment.id, tokenHash: input.accessTokenHash, expiresAt: appointmentAccessTokenExpiry(endAt) },
            select: { id: true },
          });
          // WP-10: contact snapshot + notice record (+ WhatsApp opt-in) in the same tx.
          const now = new Date();
          await tx.appointmentContact.create({
            data: {
              tenantId: tenantContext.tenantId, appointmentId: appointment.id, source: "PUBLIC_FORM",
              displayName: input.displayName, email: input.email, phone: input.phone,
              noticeVersion: CUSTOMER_NOTICE.version, noticeHash, noticeShownAt: now,
              whatsappOptIn: optIn,
              optInVersion: optIn ? WHATSAPP_OPTIN.version : null,
              optInHash,
              optInAt: optIn ? now : null,
            },
            select: { id: true },
          });
          return { status: "created" as const, appointmentId: appointment.id };
        });
      } catch { return "persistence_failure"; }
    },
  };
}
