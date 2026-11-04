import type { ApplicationIdentity } from "../domain/auth-identity";
import type { AppointmentStatus } from "../domain/appointment";
import type { TenantContext } from "../domain/tenant-context";

// WP-04 / ADR-044 §3 Option A: in-app notifications derived from Appointment.
// Read-only. No read/unread state, no new table, no booking-semantics change.

export const RECENT_WINDOW_DAYS = 7;
export const PENDING_LIMIT = 20;
export const RECENT_LIMIT = 20;

export const RECENT_STATUSES = ["CONFIRMED", "REJECTED", "CANCELLED", "COMPLETED"] as const satisfies readonly AppointmentStatus[];

export type InAppNotificationScope =
  | Readonly<{ kind: "tenant" }>
  | Readonly<{ kind: "staff"; staffId: string }>;

export type InAppNotificationKind = "PENDING_REQUEST" | "STATUS_CHANGED";

export type InAppNotificationItem = Readonly<{
  appointmentId: string;
  kind: InAppNotificationKind;
  status: AppointmentStatus;
  startAt: Date;
  updatedAt: Date;
  serviceName: string;
  staffDisplayName: string;
  /** Admin (tenant) scope only. Never present in staff results (WP4-R7 / E2). */
  customerDisplayName?: string;
}>;

export type InAppNotificationReadOptions = Readonly<{
  since: Date;
  pendingLimit: number;
  recentLimit: number;
}>;

export type InAppNotificationSnapshot = Readonly<{
  pendingCount: number;
  pending: ReadonlyArray<InAppNotificationItem>;
  recent: ReadonlyArray<InAppNotificationItem>;
}>;

export type InAppNotificationRepository = Readonly<{
  read(
    tenantContext: TenantContext,
    scope: InAppNotificationScope,
    options: InAppNotificationReadOptions,
  ): Promise<InAppNotificationSnapshot>;
}>;

export type InAppNotificationAuthorizer = Readonly<{
  authorizeAdmin(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean>;
  authorizeStaffScope(identity: ApplicationIdentity, tenantContext: TenantContext, staffId: string): Promise<boolean>;
}>;

export type InAppNotificationResult =
  | Readonly<{ status: "ok" } & InAppNotificationSnapshot>
  | Readonly<{ status: "UNAUTHORIZED" }>
  | Readonly<{ status: "INVALID_INPUT" }>
  | Readonly<{ status: "PERSISTENCE_FAILURE" }>;

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value);
}

function withoutCustomer(item: InAppNotificationItem): InAppNotificationItem {
  return {
    appointmentId: item.appointmentId,
    kind: item.kind,
    status: item.status,
    startAt: item.startAt,
    updatedAt: item.updatedAt,
    serviceName: item.serviceName,
    staffDisplayName: item.staffDisplayName,
  };
}

export function createInAppNotifications(
  dependencies: Readonly<{
    repository: InAppNotificationRepository;
    authorizer: InAppNotificationAuthorizer;
    now?: () => Date;
  }>,
) {
  const now = dependencies.now ?? (() => new Date());

  function options(): InAppNotificationReadOptions {
    return {
      since: new Date(now().getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      pendingLimit: PENDING_LIMIT,
      recentLimit: RECENT_LIMIT,
    };
  }

  return {
    async forAdmin(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<InAppNotificationResult> {
      if (!(await dependencies.authorizer.authorizeAdmin(identity, tenantContext))) {
        return { status: "UNAUTHORIZED" };
      }
      try {
        const snapshot = await dependencies.repository.read(tenantContext, { kind: "tenant" }, options());
        return { status: "ok", pendingCount: snapshot.pendingCount, pending: snapshot.pending, recent: snapshot.recent };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },

    async forStaff(identity: ApplicationIdentity, tenantContext: TenantContext, staffId: string): Promise<InAppNotificationResult> {
      if (!(await dependencies.authorizer.authorizeStaffScope(identity, tenantContext, staffId))) {
        return { status: "UNAUTHORIZED" };
      }
      if (!isValidId(staffId)) return { status: "INVALID_INPUT" };
      try {
        const snapshot = await dependencies.repository.read(tenantContext, { kind: "staff", staffId }, options());
        return {
          status: "ok",
          pendingCount: snapshot.pendingCount,
          pending: snapshot.pending.map(withoutCustomer),
          recent: snapshot.recent.map(withoutCustomer),
        };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },
  };
}

/** Plain, serializable shape returned by the no-arg server actions (dates as ISO strings). */
export type InAppNotificationViewItem = Readonly<{
  appointmentId: string;
  kind: InAppNotificationKind;
  status: AppointmentStatus;
  startAt: string;
  updatedAt: string;
  serviceName: string;
  staffDisplayName: string;
  customerDisplayName?: string;
}>;

export type InAppNotificationView =
  | Readonly<{
      status: "ok";
      pendingCount: number;
      pending: InAppNotificationViewItem[];
      recent: InAppNotificationViewItem[];
    }>
  | Readonly<{ status: "UNAUTHORIZED" | "INVALID_INPUT" | "PERSISTENCE_FAILURE" }>;

function toViewItem(item: InAppNotificationItem): InAppNotificationViewItem {
  const base = {
    appointmentId: item.appointmentId,
    kind: item.kind,
    status: item.status,
    startAt: item.startAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    serviceName: item.serviceName,
    staffDisplayName: item.staffDisplayName,
  };
  return item.customerDisplayName === undefined ? base : { ...base, customerDisplayName: item.customerDisplayName };
}

export function toInAppNotificationView(result: InAppNotificationResult): InAppNotificationView {
  if (result.status !== "ok") return { status: result.status };
  return {
    status: "ok",
    pendingCount: result.pendingCount,
    pending: result.pending.map(toViewItem),
    recent: result.recent.map(toViewItem),
  };
}
