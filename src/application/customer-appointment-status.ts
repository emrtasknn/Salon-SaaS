import type { AppointmentStatus } from "../domain/appointment";
import { transitionAppointmentStatus } from "../domain/appointment";
import {
  canCustomerCancel,
  customerCancelDeadline,
  hashAppointmentAccessToken,
} from "../domain/appointment-access-token";
import type { TenantContext } from "../domain/tenant-context";
import type { WhatsAppConsentState } from "../domain/appointment-contact";
import { isCalendarEligible } from "../domain/calendar-event";
import { salonDirectionsUrl } from "../domain/tenant";
import type { StatusLinkRateLimiter } from "./status-link-rate-limit";

// WP-06: customer status link (view + self-cancel). The tenant is resolved from the
// slug server-side; the token only selects an appointment inside that tenant.

export type CustomerAppointmentView = Readonly<{
  salonName: string; serviceName: string; staffName: string;
  startAtIso: string; endAtIso: string; timeZone: string;
  status: AppointmentStatus; canCancel: boolean; cancelDeadlineIso: string;
  /** Add-to-calendar: stable event UID, salon public address (null when unset), open + not started. */
  calendarUid: string; salonAddress: string | null; calendarEligible: boolean;
  /** Salon location: address text + server-computed allowlisted directions link; null when nothing is set. */
  location: CustomerSalonLocation | null;
}>;

/** Same shape as the public salon page location; the raw mapsUrl never reaches the client. */
export type CustomerSalonLocation = Readonly<{ address: string | null; directionsUrl: string }>;

export type CustomerWhatsAppState = WhatsAppConsentState;

/** WP-10: status-link WhatsApp opt-out (contract StopWhatsAppResult). */
export type CustomerStopWhatsAppResult = Readonly<{
  status: "stopped" | "already_stopped" | "not_opted_in" | "not_found" | "rate_limited";
}>;

export type CustomerAppointmentLoadResult =
  /** WP-10: `whatsapp` = opt-in state of this booking's contact snapshot (NONE without a record). */
  | { status: "ok"; appointment: CustomerAppointmentView; whatsapp: CustomerWhatsAppState }
  | { status: "NOT_FOUND" } | { status: "RATE_LIMITED" };

export type CustomerCancelResult =
  | { status: "CANCELLED" } | { status: "ALREADY_CANCELLED" }
  | { status: "CUTOFF_PASSED" } | { status: "NOT_CANCELLABLE" }
  | { status: "NOT_FOUND" } | { status: "RATE_LIMITED" };

export type StatusLinkTenant = Readonly<{
  tenantContext: TenantContext; name: string; timezone: string;
  /** Customer-facing salon address (already public on the salon page). */
  publicAddress?: string | null;
  /** Stored maps link; server-only, exposed only through salonDirectionsUrl (allowlisted). */
  mapsUrl?: string | null;
}>;

export type CustomerAppointmentDetails = Readonly<{
  appointmentId: string; status: AppointmentStatus; startAt: Date; endAt: Date;
  serviceName: string; staffName: string;
  whatsapp: CustomerWhatsAppState;
}>;

export type CustomerAppointmentState = Readonly<{ status: AppointmentStatus; startAt: Date }>;

/** Operations available inside one tenant-scoped transaction. */
export type CustomerAppointmentCancelTx = Readonly<{
  /** Usable token (tenantId, tokenHash, not revoked, expiresAt > now) joined to its tenant appointment. */
  findByTokenHash(tokenHash: string, now: Date): Promise<(CustomerAppointmentState & { appointmentId: string }) | null>;
  readAppointment(appointmentId: string): Promise<CustomerAppointmentState | null>;
  /** Optimistic update `{tenantId, id, status: from}`; true when exactly one row changed. */
  updateStatus(appointmentId: string, from: AppointmentStatus, to: AppointmentStatus): Promise<boolean>;
}>;

export type CustomerAppointmentStatusRepository = Readonly<{
  findDetailsByTokenHash(tenantContext: TenantContext, tokenHash: string, now: Date): Promise<CustomerAppointmentDetails | null>;
  inCancelTransaction<T>(tenantContext: TenantContext, operation: (tx: CustomerAppointmentCancelTx) => Promise<T>): Promise<T>;
  /**
   * WP-10: in one tenant-scoped tx, resolves the usable token and sets AppointmentContact.optOutAt = now
   * where whatsappOptIn and optOutAt IS NULL (idempotent).
   */
  stopWhatsAppByTokenHash(tenantContext: TenantContext, tokenHash: string, now: Date):
    Promise<"stopped" | "already_stopped" | "not_opted_in" | "not_found">;
}>;

export type CustomerAppointmentStatusDependencies = Readonly<{
  resolveTenantBySlug(slug: string): Promise<StatusLinkTenant | null>;
  repository: CustomerAppointmentStatusRepository;
  limiter: StatusLinkRateLimiter;
  now?: () => Date;
  /** Structured success log; never receives the token. */
  logCancelled?: (event: Readonly<{ tenantId: string; appointmentId: string; actorKind: "customer_token" }>) => void;
  /** Structured WhatsApp opt-out log; never receives the token. */
  logWhatsAppStopped?: (event: Readonly<{ tenantId: string; actorKind: "customer_token" }>) => void;
}>;

function salonLocation(tenant: StatusLinkTenant): CustomerSalonLocation | null {
  const address = tenant.publicAddress?.trim() || null;
  const directionsUrl = salonDirectionsUrl({ publicAddress: address, mapsUrl: tenant.mapsUrl ?? null });
  if (!directionsUrl) return null;
  return { address, directionsUrl };
}

type Resolved = { tenant: StatusLinkTenant; tokenHash: string } | { status: "NOT_FOUND" } | { status: "RATE_LIMITED" };

type CancelOutcome =
  | { status: "CANCELLED"; appointmentId: string }
  | { status: "ALREADY_CANCELLED" } | { status: "CUTOFF_PASSED" }
  | { status: "NOT_CANCELLABLE" } | { status: "NOT_FOUND" };

const MAX_SLUG_LENGTH = 100;

function normalizeSlug(slug: unknown): string | null {
  if (typeof slug !== "string") return null;
  const normalized = slug.trim().toLowerCase();
  // Server actions are public endpoints; cap the length before any DB lookup.
  if (normalized.length === 0 || normalized.length > MAX_SLUG_LENGTH) return null;
  return normalized;
}

function evaluate(state: CustomerAppointmentState, now: Date): "ALREADY_CANCELLED" | "NOT_CANCELLABLE" | "CUTOFF_PASSED" | "OK" {
  if (state.status === "CANCELLED") return "ALREADY_CANCELLED";
  if (state.status !== "PENDING" && state.status !== "CONFIRMED") return "NOT_CANCELLABLE";
  if (!canCustomerCancel(state.status, state.startAt, now)) return "CUTOFF_PASSED";
  return "OK";
}

export function createCustomerAppointmentStatus(dependencies: CustomerAppointmentStatusDependencies) {
  const now = dependencies.now ?? (() => new Date());

  // Counts invalid lookups; once an IP is over the miss budget it gets RATE_LIMITED.
  async function miss(): Promise<{ status: "NOT_FOUND" } | { status: "RATE_LIMITED" }> {
    if ((await dependencies.limiter.hit("status.miss")) === "limited") return { status: "RATE_LIMITED" };
    return { status: "NOT_FOUND" };
  }

  async function resolve(slug: unknown, token: unknown): Promise<Resolved> {
    if ((await dependencies.limiter.hit("status.view")) === "limited") return { status: "RATE_LIMITED" };
    const tokenHash = hashAppointmentAccessToken(token);
    const normalizedSlug = normalizeSlug(slug);
    if (tokenHash === null || normalizedSlug === null) return miss();
    const tenant = await dependencies.resolveTenantBySlug(normalizedSlug);
    if (!tenant) return miss();
    return { tenant, tokenHash };
  }

  return {
    async view(slug: unknown, token: unknown): Promise<CustomerAppointmentLoadResult> {
      const resolved = await resolve(slug, token);
      if ("status" in resolved) return resolved;
      const at = now();
      const details = await dependencies.repository.findDetailsByTokenHash(resolved.tenant.tenantContext, resolved.tokenHash, at);
      if (!details) return miss();
      return {
        status: "ok",
        appointment: {
          salonName: resolved.tenant.name,
          serviceName: details.serviceName,
          staffName: details.staffName,
          startAtIso: details.startAt.toISOString(),
          endAtIso: details.endAt.toISOString(),
          timeZone: resolved.tenant.timezone,
          status: details.status,
          canCancel: canCustomerCancel(details.status, details.startAt, at),
          cancelDeadlineIso: customerCancelDeadline(details.startAt).toISOString(),
          calendarUid: `${details.appointmentId}@salon-saas`,
          salonAddress: resolved.tenant.publicAddress?.trim() || null,
          calendarEligible: isCalendarEligible(details.status, details.startAt, at),
          location: salonLocation(resolved.tenant),
        },
        whatsapp: details.whatsapp,
      };
    },

    async cancel(slug: unknown, token: unknown): Promise<CustomerCancelResult> {
      const resolved = await resolve(slug, token);
      if ("status" in resolved) return resolved;
      const { tenant, tokenHash } = resolved;
      const at = now();
      const outcome = await dependencies.repository.inCancelTransaction(tenant.tenantContext, async (tx): Promise<CancelOutcome> => {
        const found = await tx.findByTokenHash(tokenHash, at);
        if (!found) return { status: "NOT_FOUND" };
        let state: CustomerAppointmentState = found;
        // One retry covers a concurrent PENDING -> CONFIRMED (or admin cancel) between read and update.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const verdict = evaluate(state, at);
          if (verdict !== "OK") return { status: verdict };
          const to = transitionAppointmentStatus(state.status, "CANCELLED");
          if (await tx.updateStatus(found.appointmentId, state.status, to)) {
            return { status: "CANCELLED", appointmentId: found.appointmentId };
          }
          if (attempt === 1) break;
          const reread = await tx.readAppointment(found.appointmentId);
          if (!reread) return { status: "NOT_FOUND" };
          state = reread;
        }
        return { status: "NOT_CANCELLABLE" };
      });
      if (outcome.status === "NOT_FOUND") return miss();
      if (outcome.status === "CANCELLED") {
        dependencies.logCancelled?.({
          tenantId: tenant.tenantContext.tenantId, appointmentId: outcome.appointmentId, actorKind: "customer_token",
        });
        return { status: "CANCELLED" };
      }
      return outcome;
    },

    /** WP-10: customer WhatsApp opt-out via the status link (same token resolution + limiter as cancel). */
    async stopWhatsApp(slug: unknown, token: unknown): Promise<CustomerStopWhatsAppResult> {
      const resolved = await resolve(slug, token);
      if ("status" in resolved) return { status: resolved.status === "RATE_LIMITED" ? "rate_limited" : "not_found" };
      const outcome = await dependencies.repository.stopWhatsAppByTokenHash(resolved.tenant.tenantContext, resolved.tokenHash, now());
      if (outcome === "not_found") {
        const missed = await miss();
        return { status: missed.status === "RATE_LIMITED" ? "rate_limited" : "not_found" };
      }
      if (outcome === "stopped") {
        dependencies.logWhatsAppStopped?.({ tenantId: resolved.tenant.tenantContext.tenantId, actorKind: "customer_token" });
      }
      return { status: outcome };
    },
  };
}
