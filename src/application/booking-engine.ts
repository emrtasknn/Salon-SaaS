import type { ApplicationIdentity } from "../domain/auth-identity";
import type { AppointmentRecord, AppointmentStatus } from "../domain/appointment";
import { calculateAvailability, isSlotOnClosedDate, utcToLocalDateAndMinute } from "../domain/availability";
import { generateAppointmentAccessToken } from "../domain/appointment-access-token";
import { createTenantContactPhone, type TenantStatus } from "../domain/tenant";
import { STAFF_VERBAL_OPTIN, renderStaffVerbalOptIn } from "../domain/legal-notice";
import type { TenantContext } from "../domain/tenant-context";
import type { ServiceRecord } from "../domain/service";
import type { StaffRecord } from "../domain/staff";
import type { WorkingHoursRecord } from "../domain/working-hours";

export type BookingContext = Readonly<{
  service: ServiceRecord; staff: StaffRecord; workingHours: ReadonlyArray<WorkingHoursRecord>;
  /** Appointments of this staff overlapping the requested local day (and the next one). */
  appointments: ReadonlyArray<AppointmentRecord>;
  timezone: string;
  tenantStatus: TenantStatus;
  /** Local date the context was built for. */
  dateIso: string;
  /** WP-08: closed local dates among `dateIso` and the following day (tenant-wide or for this staff). */
  closedDates: ReadonlyArray<string>;
}>;

export type CreateCustomerInput =
  | Readonly<{ kind: "existing"; profileId: string }>
  | Readonly<{ kind: "guest"; displayName: string; email: string | null; phone: string | null }>;

export type ExistingCustomerView = Readonly<{ profileId: string; displayName: string; phone: string | null; email: string | null }>;

export type CreateAppointmentPersistenceResult =
  /** `customerWhatsAppOptIn`: the contact snapshot has a WhatsApp opt-in with a phone (customer may be notified). */
  | Readonly<{ status: "created"; appointmentId: string; customerWhatsAppOptIn: boolean }>
  | Readonly<{ status: "email_exists"; existing: ExistingCustomerView }>
  | "conflict" | "slot_unavailable" | "closed_date" | "customer_not_found"
  | "invalid_resource" | "tenant_inactive" | "persistence_failure"
  /** WP-10: verbal opt-in requested but the chosen customer has no E.164 phone (nothing written). */
  | "opt_in_requires_phone";

/**
 * WP-10: AppointmentContact(source STAFF) written in the create tx. With `whatsappVerbalOptIn`
 * the STAFF_VERBAL_OPTIN version/hash and the server-derived recorder profile are stored.
 */
export type CreateContactInput = Readonly<{ whatsappVerbalOptIn: boolean; recordedByProfileId: string }>;

export type CreateOptions = Readonly<{
  timezone: string;
  services: ReadonlyArray<Readonly<{ id: string; name: string; durationMinutes: number }>>;
  staff: ReadonlyArray<Readonly<{ id: string; displayName: string }>>;
}>;

export type BookingDataRepository = Readonly<{
  /** Exactly one of `dateIso` (local day) or `at` (instant; its local day is used) must be given. */
  getBookingContext(tenantContext: TenantContext, input: Readonly<{ serviceId: string; staffId: string; dateIso?: string; at?: Date }>): Promise<BookingContext | null>;
  /** Active services and ACTIVE staff; restricted to one staff member when `staffId` is given. */
  getCreateOptions(tenantContext: TenantContext, input: Readonly<{ staffId: string | null }>): Promise<CreateOptions | null>;
  /**
   * In one tenant-context transaction: advisory lock, tenant status FOR SHARE, closure read,
   * service/staff active, working hours, conflict check, customer, insert, access token.
   * endAt is computed from the service inside the transaction.
   */
  createAppointment(tenantContext: TenantContext, input: Readonly<{
    staffId: string; serviceId: string; startAt: Date;
    customer: CreateCustomerInput;
    initialStatus: Extract<AppointmentStatus, "PENDING" | "CONFIRMED">;
    accessTokenHash: string;
    /** Absent = contact snapshot without opt-in. */
    contact?: CreateContactInput;
  }>): Promise<CreateAppointmentPersistenceResult>;
  transition(tenantContext: TenantContext, appointmentId: string, expectedFrom: AppointmentStatus, to: AppointmentStatus):
    Promise<"updated" | "not_found" | "invalid_transition" | "persistence_failure">;
}>;

/** WP-08: who may create on behalf of a customer. STAFF scope carries the server-derived staffId. */
export type AppointmentCreateScope = Readonly<{ kind: "admin" }> | Readonly<{ kind: "staff"; staffId: string }>;

export type BookingAuthorizer = Readonly<{
  authorize(identity: ApplicationIdentity, tenantContext: TenantContext, role: "TENANT_ADMIN" | "STAFF" | "CUSTOMER"): Promise<boolean>;
  authorizeStaffDecision(identity: ApplicationIdentity, tenantContext: TenantContext, appointment: AppointmentRecord): Promise<boolean>;
  /**
   * TENANT_ADMIN (or higher) -> admin; ACTIVE STAFF -> staff with their own staffId read from the
   * server (never from client input); anyone else -> null.
   */
  resolveCreateScope(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<AppointmentCreateScope | null>;
}>;

const ID_MAX = 100;
const NAME_MAX = 120;
const EMAIL_MAX = 254;
const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > ID_MAX || CONTROL.test(trimmed)) return null;
  return trimmed;
}

/** Validates customer input for the scope; "FORBIDDEN" for scope violations, null for malformed input. */
function parseCustomer(value: unknown, scope: AppointmentCreateScope): CreateCustomerInput | "FORBIDDEN" | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind === "existing") {
    // Decision (e): STAFF enter a guest only; CRM customers are TENANT_ADMIN-only.
    if (scope.kind !== "admin") return "FORBIDDEN";
    const profileId = cleanId(raw.profileId);
    return profileId ? { kind: "existing", profileId } : null;
  }
  if (raw.kind !== "guest") return null;
  if (typeof raw.displayName !== "string") return null;
  const displayName = raw.displayName.trim();
  if (!displayName || displayName.length > NAME_MAX || CONTROL.test(displayName)) return null;
  const phone = createTenantContactPhone(raw.phone ?? null);
  if (!phone.ok) return null;
  let email: string | null = null;
  if (raw.email !== undefined && raw.email !== null) {
    if (typeof raw.email !== "string") return null;
    const trimmed = raw.email.trim();
    if (trimmed) {
      if (scope.kind !== "admin") return null; // staff guest form has no email field
      if (trimmed.length > EMAIL_MAX || CONTROL.test(trimmed) || !EMAIL.test(trimmed)) return null;
      email = trimmed;
    }
  }
  return { kind: "guest", displayName, email, phone: phone.value };
}

function resolveStaffId(scope: AppointmentCreateScope, requested: unknown): string | "FORBIDDEN" | null {
  if (scope.kind === "staff") {
    // STAFF create only for themselves: any other staffId is rejected, absence uses their own.
    if (requested === undefined || requested === null) return scope.staffId;
    return cleanId(requested) === scope.staffId ? scope.staffId : "FORBIDDEN";
  }
  return cleanId(requested);
}

export function createBookingEngine(dependencies: Readonly<{ repository: BookingDataRepository; authorizer: BookingAuthorizer; now?: () => Date }>) {
  const now = () => dependencies.now?.() ?? new Date();
  return {
    async availability(identity: ApplicationIdentity, tenantContext: TenantContext, input: Readonly<{ serviceId: string; staffId: string; dateIso: string }>) {
      if (!(await dependencies.authorizer.authorize(identity, tenantContext, "CUSTOMER"))) return { status: "UNAUTHORIZED" as const, slots: [] };
      const context = await dependencies.repository.getBookingContext(tenantContext, input);
      if (!context || !context.service.active || context.staff.status !== "ACTIVE") return { status: "NOT_FOUND" as const, slots: [] };
      try {
        return { status: "ok" as const, slots: calculateAvailability({
          dateIso: input.dateIso, timeZone: context.timezone, workingHours: context.workingHours, staffId: context.staff.id,
          appointments: context.appointments, durationMinutes: context.service.durationMinutes, bufferMinutes: context.service.bufferMinutes, now: now(),
          closedDates: context.closedDates,
        }) };
      } catch { return { status: "INVALID_INPUT" as const, slots: [] }; }
    },

    /** WP-08: services/staff the caller may create for. Admin: all ACTIVE staff; staff: only themselves. */
    async createOptions(identity: ApplicationIdentity, tenantContext: TenantContext) {
      const scope = await dependencies.authorizer.resolveCreateScope(identity, tenantContext);
      if (!scope) return { status: "FORBIDDEN" as const };
      const options = await dependencies.repository.getCreateOptions(tenantContext, { staffId: scope.kind === "staff" ? scope.staffId : null });
      if (!options) return { status: "FORBIDDEN" as const };
      // WP-10: verbal opt-in checkbox text comes from the versioned template, never from the client.
      return { status: "OK" as const, options: { ...options, verbalOptIn: { version: STAFF_VERBAL_OPTIN.version, label: renderStaffVerbalOptIn() } } };
    },

    /** WP-08: slots for a staff/admin-created appointment (same availability rule as booking). */
    async slotsOnBehalf(identity: ApplicationIdentity, tenantContext: TenantContext, input: Readonly<{ serviceId: unknown; staffId?: unknown; dateIso: unknown }>) {
      const scope = await dependencies.authorizer.resolveCreateScope(identity, tenantContext);
      if (!scope) return { status: "FORBIDDEN" as const };
      const staffId = resolveStaffId(scope, input.staffId);
      if (staffId === "FORBIDDEN") return { status: "FORBIDDEN" as const };
      const serviceId = cleanId(input.serviceId);
      if (!staffId || !serviceId || typeof input.dateIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateIso)) return { status: "INVALID_INPUT" as const };
      const dateIso = input.dateIso;
      let context: BookingContext | null;
      try { context = await dependencies.repository.getBookingContext(tenantContext, { serviceId, staffId, dateIso }); } catch { return { status: "INVALID_INPUT" as const }; }
      if (!context || !context.service.active || context.staff.status !== "ACTIVE") return { status: "INVALID_INPUT" as const };
      if (context.tenantStatus !== "ACTIVE") return { status: "TENANT_INACTIVE" as const };
      if (context.closedDates.includes(dateIso)) return { status: "CLOSED_DATE" as const, timezone: context.timezone };
      try {
        const slots = calculateAvailability({
          dateIso, timeZone: context.timezone, workingHours: context.workingHours, staffId: context.staff.id,
          appointments: context.appointments, durationMinutes: context.service.durationMinutes, bufferMinutes: context.service.bufferMinutes,
          now: now(), closedDates: context.closedDates,
        });
        return { status: "OK" as const, timezone: context.timezone, slots };
      } catch { return { status: "INVALID_INPUT" as const }; }
    },

    /**
     * WP-08: staff/admin-created appointment. TENANT_ADMIN -> any ACTIVE staff of the tenant;
     * STAFF -> only their own staffId (server-derived). Same availability rule and in-transaction
     * re-check as public booking; starts CONFIRMED (owner decision a). The old unbound `create`
     * (authorized as CUSTOMER with a client-chosen staff/customer) is retired.
     */
    async createOnBehalf(identity: ApplicationIdentity, tenantContext: TenantContext, input: Readonly<{
      serviceId: unknown; staffId?: unknown; startAt: unknown; customer: unknown;
      /** WP-10: staff recorded a verbal WhatsApp opt-in from the customer (absent = false). */
      whatsappVerbalOptIn?: unknown;
    }>) {
      const scope = await dependencies.authorizer.resolveCreateScope(identity, tenantContext);
      if (!scope) return { status: "FORBIDDEN" as const };
      const staffId = resolveStaffId(scope, input.staffId);
      if (staffId === "FORBIDDEN") return { status: "FORBIDDEN" as const };
      const customer = parseCustomer(input.customer, scope);
      if (customer === "FORBIDDEN") return { status: "FORBIDDEN" as const };
      const serviceId = cleanId(input.serviceId);
      if (!staffId || !serviceId || !customer || !(input.startAt instanceof Date) || Number.isNaN(input.startAt.getTime())) {
        return { status: "INVALID_INPUT" as const };
      }
      if (input.whatsappVerbalOptIn !== undefined && typeof input.whatsappVerbalOptIn !== "boolean") return { status: "INVALID_INPUT" as const };
      const whatsappVerbalOptIn = input.whatsappVerbalOptIn === true;
      // Recorder is the acting user's own profile (server-derived identity), never client input.
      if (identity.state !== "authenticated") return { status: "FORBIDDEN" as const };
      if (whatsappVerbalOptIn && customer.kind === "guest" && customer.phone === null) return { status: "OPT_IN_REQUIRES_PHONE" as const };
      const startAt = input.startAt;

      let context: BookingContext | null;
      try { context = await dependencies.repository.getBookingContext(tenantContext, { serviceId, staffId, at: startAt }); } catch { return { status: "INVALID_INPUT" as const }; }
      if (!context || !context.service.active || context.staff.status !== "ACTIVE") return { status: "INVALID_RESOURCE" as const };
      if (context.tenantStatus !== "ACTIVE") return { status: "TENANT_INACTIVE" as const };
      const endAt = new Date(startAt.getTime() + (context.service.durationMinutes + context.service.bufferMinutes) * 60_000);
      let dateIso: string;
      try {
        dateIso = utcToLocalDateAndMinute(startAt, context.timezone).dateIso;
        if (isSlotOnClosedDate({ startAt, endAt }, context.timezone, context.closedDates)) return { status: "CLOSED_DATE" as const };
      } catch { return { status: "INVALID_INPUT" as const }; }
      const available = calculateAvailability({
        dateIso, timeZone: context.timezone, workingHours: context.workingHours, staffId: context.staff.id,
        appointments: context.appointments, durationMinutes: context.service.durationMinutes, bufferMinutes: context.service.bufferMinutes,
        now: now(), closedDates: context.closedDates,
      }).some((slot) => slot.startAt.getTime() === startAt.getTime());
      if (!available) return { status: "SLOT_UNAVAILABLE" as const };

      const { token, tokenHash } = generateAppointmentAccessToken();
      const result = await dependencies.repository.createAppointment(tenantContext, {
        staffId, serviceId, startAt, customer, initialStatus: "CONFIRMED", accessTokenHash: tokenHash,
        contact: { whatsappVerbalOptIn, recordedByProfileId: identity.profileId },
      });
      if (typeof result === "object") {
        if (result.status === "created") {
          return { status: "CREATED" as const, appointmentId: result.appointmentId, customerWhatsAppOptIn: result.customerWhatsAppOptIn, accessToken: token };
        }
        return { status: "EMAIL_EXISTS" as const, existing: result.existing };
      }
      if (result === "conflict" || result === "slot_unavailable") return { status: "SLOT_UNAVAILABLE" as const };
      if (result === "closed_date") return { status: "CLOSED_DATE" as const };
      if (result === "customer_not_found") return { status: "CUSTOMER_NOT_FOUND" as const };
      if (result === "opt_in_requires_phone") return { status: "OPT_IN_REQUIRES_PHONE" as const };
      if (result === "invalid_resource") return { status: "INVALID_RESOURCE" as const };
      if (result === "tenant_inactive") return { status: "TENANT_INACTIVE" as const };
      return { status: "PERSISTENCE_FAILURE" as const };
    },

    async transition(identity: ApplicationIdentity, tenantContext: TenantContext, appointment: AppointmentRecord, to: AppointmentStatus) {
      const authorized = to === "CONFIRMED" || to === "REJECTED"
        ? await dependencies.authorizer.authorizeStaffDecision(identity, tenantContext, appointment)
        : await dependencies.authorizer.authorize(identity, tenantContext, "TENANT_ADMIN");
      if (!authorized) return { status: "UNAUTHORIZED" as const };
      const result = await dependencies.repository.transition(tenantContext, appointment.id, appointment.status, to);
      if (result === "updated") return { status: "updated" as const };
      if (result === "not_found") return { status: "NOT_FOUND" as const };
      if (result === "invalid_transition") return { status: "INVALID_TRANSITION" as const };
      return { status: "PERSISTENCE_FAILURE" as const };
    },
  };
}
