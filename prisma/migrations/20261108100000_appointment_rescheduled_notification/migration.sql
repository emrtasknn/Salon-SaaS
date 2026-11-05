-- ADR-044 §10-5 amendment (owner decision 2026-11-05, follow-up to PR #183): customer
-- notification when staff/admin move an open appointment in the day calendar.
-- PROPOSAL — apply to staging, then pilot (owner approval) BEFORE the code is merged:
-- merging to main auto-deploys the pilot, and the code writes the new column/value.
-- Ordering: last in the schema line, after 20261107120000_tenant_rls_state_explicit.
-- Additive only: one enum value, one NOT NULL column with a default (existing rows get ''),
-- and the idempotency unique index re-created with that column appended.
-- RLS unchanged: NotificationDelivery keeps ENABLE + FORCE and its tenant policies; the
-- salon_app table grants already cover the new column.

-- AlterEnum
-- PostgreSQL >= 12 allows ADD VALUE inside a transaction block as long as the new value
-- is not used in the same transaction. Nothing below references 'APPOINTMENT_RESCHEDULED'.
-- Irreversible: PostgreSQL cannot drop an enum value.
ALTER TYPE "NotificationEventType" ADD VALUE 'APPOINTMENT_RESCHEDULED';

-- AlterTable
-- eventKey separates repeated events of the same type for one appointment (one key per
-- reschedule). Every other event type keeps the empty key, so its idempotency is unchanged.
ALTER TABLE "NotificationDelivery" ADD COLUMN "eventKey" TEXT NOT NULL DEFAULT '';

-- Re-create the idempotency key with eventKey appended (existing rows all have '', so the
-- old uniqueness implies the new one; no duplicates are possible).
DROP INDEX "NotificationDelivery_idempotency_key";
CREATE UNIQUE INDEX "NotificationDelivery_idempotency_key"
  ON "NotificationDelivery"("tenantId", "appointmentId", "eventType", "channel", "recipientProfileId", "eventKey");

-- Rollback (only while no APPOINTMENT_RESCHEDULED row exists and old code is deployed):
--   DROP INDEX "NotificationDelivery_idempotency_key";
--   CREATE UNIQUE INDEX "NotificationDelivery_idempotency_key"
--     ON "NotificationDelivery"("tenantId", "appointmentId", "eventType", "channel", "recipientProfileId");
--   ALTER TABLE "NotificationDelivery" DROP COLUMN "eventKey";
-- The enum value stays (harmless when unused).
