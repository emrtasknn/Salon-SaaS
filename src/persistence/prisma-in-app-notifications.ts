import {
  RECENT_STATUSES,
  type InAppNotificationItem,
  type InAppNotificationKind,
  type InAppNotificationRepository,
} from "../application/in-app-notifications";
import type { AppointmentStatus } from "../domain/appointment";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";

type NotificationSelect = {
  id: true;
  status: true;
  startAt: true;
  updatedAt: true;
  staff: { select: { profile: { select: { displayName: true } } } };
  service: { select: { name: true } };
  customerProfile?: { select: { displayName: true } };
};

type NotificationRow = {
  id: string;
  status: AppointmentStatus;
  startAt: Date;
  updatedAt: Date;
  staff: { profile: { displayName: string } };
  service: { name: string };
  customerProfile?: { displayName: string };
};

type Tx = PrismaTenantTransactionClient & {
  appointment: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Record<string, "asc" | "desc">;
      take: number;
      select: NotificationSelect;
    }): Promise<NotificationRow[]>;
  };
};

function toItem(row: NotificationRow, kind: InAppNotificationKind, includeCustomer: boolean): InAppNotificationItem {
  const base = {
    appointmentId: row.id,
    kind,
    status: row.status,
    startAt: row.startAt,
    updatedAt: row.updatedAt,
    serviceName: row.service.name,
    staffDisplayName: row.staff.profile.displayName,
  };
  return includeCustomer && row.customerProfile
    ? { ...base, customerDisplayName: row.customerProfile.displayName }
    : base;
}

export function createPrismaInAppNotificationRepository(prisma: PrismaTenantClient): InAppNotificationRepository {
  return {
    async read(tenantContext, scope, options) {
      const includeCustomer = scope.kind === "tenant";
      const scopeWhere = scope.kind === "staff"
        ? { tenantId: tenantContext.tenantId, staffId: scope.staffId }
        : { tenantId: tenantContext.tenantId };
      // Only display names and service name; never email/phone. Customer name only for tenant (admin) scope.
      const select: NotificationSelect = {
        id: true,
        status: true,
        startAt: true,
        updatedAt: true,
        staff: { select: { profile: { select: { displayName: true } } } },
        service: { select: { name: true } },
        ...(includeCustomer ? { customerProfile: { select: { displayName: true } } } : {}),
      };

      return withPrismaTenantContext(prisma, tenantContext, async (tx: Tx) => {
        const pendingCount = await tx.appointment.count({
          where: { ...scopeWhere, status: "PENDING" },
        });
        const pending = await tx.appointment.findMany({
          where: { ...scopeWhere, status: "PENDING" },
          orderBy: { startAt: "asc" },
          take: options.pendingLimit,
          select,
        });
        const recent = await tx.appointment.findMany({
          where: { ...scopeWhere, status: { in: [...RECENT_STATUSES] }, updatedAt: { gte: options.since } },
          orderBy: { updatedAt: "desc" },
          take: options.recentLimit,
          select,
        });
        return {
          pendingCount,
          pending: pending.map((row) => toItem(row, "PENDING_REQUEST", includeCustomer)),
          recent: recent.map((row) => toItem(row, "STATUS_CHANGED", includeCustomer)),
        };
      });
    },
  };
}
