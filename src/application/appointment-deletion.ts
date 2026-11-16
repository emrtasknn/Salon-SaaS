import type { ApplicationIdentity } from "../domain/auth-identity";
import type { AppointmentRecord } from "../domain/appointment";
import type { TenantContext } from "../domain/tenant-context";
import { appointmentDeleteRule, isRecordId, type AppointmentDeleteActor, type DeleteResult } from "../domain/deletion";

export type AppointmentDeletionRepository = Readonly<{
  /** null when missing or already archived. */
  find(tenantContext: TenantContext, id: string): Promise<AppointmentRecord | null>;
  archive(tenantContext: TenantContext, id: string, at: Date): Promise<"archived" | "not_found" | "not_terminal">;
}>;

export function createAppointmentDeletion(deps: Readonly<{
  repository: AppointmentDeletionRepository;
  authorizer: {
    authorizeAdmin(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean>;
    authorizeAssignedStaff(identity: ApplicationIdentity, tenantContext: TenantContext, appointment: AppointmentRecord): Promise<boolean>;
  };
  now?: () => Date;
}>) {
  return {
    async delete(identity: ApplicationIdentity, tenantContext: TenantContext, appointmentId: unknown): Promise<DeleteResult> {
      if (identity.state !== "authenticated") return { status: "FORBIDDEN" };
      if (!isRecordId(appointmentId)) return { status: "INVALID_INPUT" };
      try {
        const appointment = await deps.repository.find(tenantContext, appointmentId);
        if (!appointment) return { status: "NOT_FOUND" };

        let actor: AppointmentDeleteActor;
        if (await deps.authorizer.authorizeAdmin(identity, tenantContext)) actor = "TENANT_ADMIN";
        else if (await deps.authorizer.authorizeAssignedStaff(identity, tenantContext, appointment)) actor = "ASSIGNED_STAFF";
        else return { status: "FORBIDDEN" };

        const rule = appointmentDeleteRule(actor, appointment.status);
        if (rule === "MUST_CANCEL_FIRST") return { status: "MUST_CANCEL_FIRST" };
        if (rule === "FORBIDDEN") return { status: "FORBIDDEN" };

        const result = await deps.repository.archive(tenantContext, appointmentId, deps.now?.() ?? new Date());
        if (result === "archived") return { status: "DELETED" };
        return { status: result === "not_terminal" ? "MUST_CANCEL_FIRST" : "NOT_FOUND" };
      } catch {
        return { status: "PERSISTENCE_FAILURE" };
      }
    },
  };
}
