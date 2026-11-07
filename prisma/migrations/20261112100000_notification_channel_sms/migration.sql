-- Customer SMS channel via Twilio (owner decision 2026-11-07): appointment confirmed /
-- rejected / rescheduled messages to customers with an active opt-in. Staff and tenant
-- admins never get SMS (limited credits).
-- PROPOSAL — apply to staging, then pilot (owner approval) BEFORE the code is merged:
-- merging to main auto-deploys the pilot, and the code writes the new value.
-- Ordering: last in the schema line, after 20261111100000_appointment_services.
-- Additive only: one enum value. No table, column, index, grant or RLS change;
-- NotificationDelivery keeps ENABLE + FORCE and its tenant policies.

-- AlterEnum
-- PostgreSQL >= 12 allows ADD VALUE inside a transaction block as long as the new value
-- is not used in the same transaction. Nothing below references 'SMS'.
-- Irreversible: PostgreSQL cannot drop an enum value.
ALTER TYPE "NotificationChannel" ADD VALUE 'SMS';

-- Rollback: deploy the previous code. The enum value stays (harmless when unused).
