import type { ApplicationIdentity } from "../domain/auth-identity";
import type { TenantContext } from "../domain/tenant-context";
import { utcToLocalDateAndMinute } from "../domain/availability";
import { normalizeClosureReason, parseClosureDate, parseClosureRange, type ClosureRecord } from "../domain/closure-date";

// WP-08: tenant-wide closed dates (owner decision c). Creating a closure never touches
// appointments; PENDING/CONFIRMED appointments on the date require explicit confirmation (d).

export type ClosureImpactAppointment = Readonly<{
  id: string; startAt: Date; staffName: string; customerName: string; status: "PENDING" | "CONFIRMED";
}>;

export type ClosureRepository = Readonly<{
  list(tenantContext: TenantContext, range: Readonly<{ from: string; to: string }>):
    Promise<Readonly<{ timezone: string; closures: ReadonlyArray<ClosureRecord> }> | null>;
  impact(tenantContext: TenantContext, dateIso: string):
    Promise<Readonly<{ timezone: string; appointments: ReadonlyArray<ClosureImpactAppointment> }> | null>;
  /**
   * One transaction: Tenant FOR UPDATE, past-date check (tenant-local today), existing tenant-wide
   * closure -> duplicate, impact -> has_appointments unless confirmed, insert.
   */
  create(tenantContext: TenantContext, input: Readonly<{
    date: string; reason: string | null; createdByProfileId: string; confirmExistingAppointments: boolean; now: Date;
  }>): Promise<
    | Readonly<{ status: "created"; closure: ClosureRecord }>
    | Readonly<{ status: "has_appointments"; timezone: string; appointments: ReadonlyArray<ClosureImpactAppointment> }>
    | "duplicate" | "past_date" | "not_found"
  >;
  delete(tenantContext: TenantContext, closureId: string): Promise<"deleted" | "not_found">;
}>;

export type ClosureAuthorizer = Readonly<{
  authorizeAdmin(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean>;
}>;

export type ClosureImpactView = Readonly<{
  id: string; startLabel: string; staffName: string; customerName: string; status: "PENDING" | "CONFIRMED";
}>;

function toImpactViews(timezone: string, appointments: ReadonlyArray<ClosureImpactAppointment>): ClosureImpactView[] {
  return [...appointments]
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((a) => {
      const minute = utcToLocalDateAndMinute(a.startAt, timezone).minute;
      const startLabel = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      return { id: a.id, startLabel, staffName: a.staffName, customerName: a.customerName, status: a.status };
    });
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100 || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

export function createClosureManagement(dependencies: Readonly<{
  repository: ClosureRepository; authorizer: ClosureAuthorizer; now?: () => Date;
}>) {
  const now = () => dependencies.now?.() ?? new Date();
  const authorized = (identity: ApplicationIdentity, tenantContext: TenantContext) =>
    identity.state === "authenticated" ? dependencies.authorizer.authorizeAdmin(identity, tenantContext) : Promise.resolve(false);

  return {
    async list(identity: ApplicationIdentity, tenantContext: TenantContext, input: Readonly<{ from: unknown; to: unknown }>) {
      if (!(await authorized(identity, tenantContext))) return { status: "FORBIDDEN" as const };
      const range = parseClosureRange(input.from, input.to);
      if (!range) return { status: "INVALID_INPUT" as const };
      const result = await dependencies.repository.list(tenantContext, range);
      if (!result) return { status: "FORBIDDEN" as const };
      return { status: "OK" as const, timezone: result.timezone, closures: result.closures };
    },

    async previewImpact(identity: ApplicationIdentity, tenantContext: TenantContext, date: unknown) {
      if (!(await authorized(identity, tenantContext))) return { status: "FORBIDDEN" as const };
      const dateIso = parseClosureDate(date);
      if (!dateIso) return { status: "INVALID_INPUT" as const };
      const result = await dependencies.repository.impact(tenantContext, dateIso);
      if (!result) return { status: "FORBIDDEN" as const };
      return { status: "OK" as const, appointments: toImpactViews(result.timezone, result.appointments) };
    },

    async create(identity: ApplicationIdentity, tenantContext: TenantContext, input: Readonly<{
      date: unknown; reason?: unknown; confirmExistingAppointments: unknown;
    }>) {
      if (identity.state !== "authenticated" || !(await authorized(identity, tenantContext))) return { status: "FORBIDDEN" as const };
      const dateIso = parseClosureDate(input.date);
      const reason = normalizeClosureReason(input.reason);
      if (!dateIso || !reason.ok || typeof input.confirmExistingAppointments !== "boolean") return { status: "INVALID_INPUT" as const };
      const result = await dependencies.repository.create(tenantContext, {
        date: dateIso, reason: reason.value, createdByProfileId: identity.profileId,
        confirmExistingAppointments: input.confirmExistingAppointments, now: now(),
      });
      if (result === "duplicate") return { status: "DUPLICATE" as const };
      if (result === "past_date") return { status: "PAST_DATE" as const };
      if (result === "not_found") return { status: "FORBIDDEN" as const };
      if (result.status === "has_appointments") {
        return { status: "HAS_APPOINTMENTS" as const, appointments: toImpactViews(result.timezone, result.appointments) };
      }
      return { status: "CREATED" as const, closure: result.closure };
    },

    async delete(identity: ApplicationIdentity, tenantContext: TenantContext, closureId: unknown) {
      if (!(await authorized(identity, tenantContext))) return { status: "FORBIDDEN" as const };
      const id = cleanId(closureId);
      if (!id) return { status: "NOT_FOUND" as const };
      return { status: (await dependencies.repository.delete(tenantContext, id)) === "deleted" ? "DELETED" as const : "NOT_FOUND" as const };
    },
  };
}
