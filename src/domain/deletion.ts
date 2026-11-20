import type { AppointmentStatus } from "./appointment";

/** Display name that replaces the personal data of an anonymized (deleted) customer. */
export const DELETED_CUSTOMER_NAME = "Silinmiş müşteri";

export type DeleteFailureCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "NOT_DELETABLE"
  | "MUST_CANCEL_FIRST"
  | "TENANT_ACTIVE"
  | "CONFIRMATION_MISMATCH"
  | "PERSISTENCE_FAILURE";

export type DeleteResult =
  | { status: "DELETED" }
  | { status: DeleteFailureCode }
  | { status: "HAS_ACTIVE_APPOINTMENTS"; count: number };

const RECORD_ID_MAX_LENGTH = 100;

/** Non-empty, trimmed, <= 100 chars, no control characters. */
export function isRecordId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > RECORD_ID_MAX_LENGTH) return false;
  if (value.trim() !== value) return false;
  return !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

export type AppointmentDeleteActor = "TENANT_ADMIN" | "ASSIGNED_STAFF";

/** Active appointments must be cancelled first; only admins may delete COMPLETED ones. */
export function appointmentDeleteRule(
  actor: AppointmentDeleteActor,
  status: AppointmentStatus,
): "ALLOWED" | "MUST_CANCEL_FIRST" | "FORBIDDEN" {
  switch (status) {
    case "PENDING":
    case "CONFIRMED":
      return "MUST_CANCEL_FIRST";
    case "REJECTED":
    case "CANCELLED":
      return "ALLOWED";
    case "COMPLETED":
      return actor === "TENANT_ADMIN" ? "ALLOWED" : "FORBIDDEN";
  }
}
