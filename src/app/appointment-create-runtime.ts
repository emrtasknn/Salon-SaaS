import "server-only";
import { createBookingEngine } from "../application/booking-engine";
import { resolveAppointmentCreateScope } from "../application/appointment-create-scope";
import { enforceServerAuthorization } from "../application/server-authorization-enforcement";
import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import { utcToLocalDateAndMinute } from "../domain/availability";
import { createPrismaBookingRepository } from "../persistence/prisma-booking-engine";
import type { createPrismaMembershipReader } from "../persistence/prisma-membership-reader";
import { withPrismaTenantContext, type PrismaTenantTransactionClient } from "../persistence/prisma-tenant-context";
import type { getPrisma } from "../infrastructure/prisma-runtime";
import { publishAppointmentNotification } from "./notification-runtime";
import type { CreateAppointmentResult, CreateOptionsView, SlotListResult } from "./appointment-create-contract";

// WP-08: shared server wiring for the staff/admin create-appointment actions.
// Not a "use server" module: nothing here is callable from the client.

type Prisma = ReturnType<typeof getPrisma>;
type Reader = ReturnType<typeof createPrismaMembershipReader>;
type StaffLookupTx = PrismaTenantTransactionClient & {
  staff: {
    findUnique(args: { where: { tenantId_profileId: { tenantId: string; profileId: string } } }):
      Promise<{ id: string; tenantId: string; profileId: string; status: "ACTIVE" | "INACTIVE" } | null>;
  };
};

export function createOnBehalfBookingEngine(prisma: Prisma, reader: Reader) {
  const authorizeAdmin = async (identity: ApplicationIdentity, tenantContext: TenantContext) =>
    (await enforceServerAuthorization({ identity, tenantContext, requiredRole: "TENANT_ADMIN" }, reader)).authorization.status === "allowed";
  const staffReader = {
    findByProfileId(tenantContext: TenantContext, profileId: string) {
      return withPrismaTenantContext(prisma, tenantContext, async (tx: StaffLookupTx) =>
        tx.staff.findUnique({ where: { tenantId_profileId: { tenantId: tenantContext.tenantId, profileId } } }));
    },
  };
  return createBookingEngine({
    repository: createPrismaBookingRepository(prisma),
    authorizer: {
      // This engine instance serves only the create-on-behalf paths; transitions and the
      // CUSTOMER-level availability stay on the existing per-page wiring, so deny them here.
      async authorize() { return false; },
      async authorizeStaffDecision() { return false; },
      async resolveCreateScope(identity, tenantContext) {
        return resolveAppointmentCreateScope({ authorizeAdmin, membershipReader: reader, staffReader }, identity, tenantContext);
      },
    },
  });
}

type Engine = ReturnType<typeof createOnBehalfBookingEngine>;

export async function readCreateOptions(engine: Engine, identity: ApplicationIdentity, tenantContext: TenantContext): Promise<CreateOptionsView | null> {
  const result = await engine.createOptions(identity, tenantContext);
  return result.status === "OK" ? result.options : null;
}

function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export async function listSlotsOnBehalf(
  engine: Engine, identity: ApplicationIdentity, tenantContext: TenantContext,
  input: Readonly<{ serviceId: unknown; staffId?: unknown; date: unknown }>,
): Promise<SlotListResult> {
  const result = await engine.slotsOnBehalf(identity, tenantContext, { serviceId: input.serviceId, staffId: input.staffId, dateIso: input.date });
  if (result.status !== "OK") return { status: result.status };
  return {
    status: "OK",
    slots: result.slots.map((slot) => ({
      startAt: slot.startAt.toISOString(),
      label: minuteLabel(utcToLocalDateAndMinute(slot.startAt, result.timezone).minute),
    })),
  };
}

function parseStartAt(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Creates via the booking engine and, on success with notifyCustomer and a customer phone,
 * publishes APPOINTMENT_CONFIRMED through the existing pipeline (owner decision b).
 */
export async function createOnBehalf(
  engine: Engine, identity: ApplicationIdentity, tenantContext: TenantContext,
  input: Readonly<{ serviceId: unknown; staffId?: unknown; startAt: unknown; customer: unknown; notifyCustomer: unknown }>,
): Promise<CreateAppointmentResult> {
  const startAt = parseStartAt(input.startAt);
  if (!startAt || typeof input.notifyCustomer !== "boolean") return { status: "INVALID_INPUT" };
  const result = await engine.createOnBehalf(identity, tenantContext, {
    serviceId: input.serviceId, staffId: input.staffId, startAt, customer: input.customer,
  });
  switch (result.status) {
    case "CREATED": {
      let notified = false;
      if (input.notifyCustomer && result.customerPhone) {
        const published = await publishAppointmentNotification(tenantContext, result.appointmentId, "APPOINTMENT_CONFIRMED");
        // WP-09 B1: only a WhatsApp delivery reaches the customer; staff/admin Web Push never counts.
        notified = published.status === "processed" && published.results.some((r) => r.channel === "WHATSAPP" && r.status === "SENT");
      }
      return { status: "CREATED", appointmentId: result.appointmentId, notified };
    }
    case "EMAIL_EXISTS":
      return { status: "EMAIL_EXISTS", existing: result.existing };
    case "INVALID_RESOURCE":
      return { status: "INVALID_INPUT" };
    case "PERSISTENCE_FAILURE":
      // Contract has no failure status; the most likely cause is a concurrent write on the slot.
      return { status: "SLOT_UNAVAILABLE" };
    default:
      return { status: result.status };
  }
}
