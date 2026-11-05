-- WP-10 (design A): KVKK controller identity on Tenant + per-appointment
-- contact snapshot with notice record and WhatsApp opt-in/opt-out, tenant-scoped under RLS.
-- PROPOSAL — apply only after owner approval, and validate in CI (isolated PostgreSQL 17) first.
-- Ordering: after 20261105140000_whatsapp_delivery_tenant_resolver (WP-02c).
-- Additive only. New Tenant columns are nullable (all existing rows NULL, so
-- the CHECKs cannot fail on apply). No backfill: old appointments get no
-- AppointmentContact row, so they never receive customer WhatsApp (owner decision 2).
-- No IP / user-agent columns (data minimisation).

-- CreateEnum (matches `prisma migrate diff` output for enum AppointmentContactSource)
CREATE TYPE "AppointmentContactSource" AS ENUM ('PUBLIC_FORM', 'STAFF');

-- AlterTable (matches `prisma migrate diff` output for model Tenant)
ALTER TABLE "Tenant" ADD COLUMN     "kvkkContactEmail" VARCHAR(254),
ADD COLUMN     "legalAddress" VARCHAR(500),
ADD COLUMN     "legalName" VARCHAR(200);

-- CreateTable (matches `prisma migrate diff` output for model AppointmentContact)
CREATE TABLE "AppointmentContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "source" "AppointmentContactSource" NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "email" VARCHAR(254),
    "phone" TEXT,
    "noticeVersion" VARCHAR(64),
    "noticeHash" TEXT,
    "noticeShownAt" TIMESTAMP(3),
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
    "optInVersion" VARCHAR(64),
    "optInHash" TEXT,
    "optInAt" TIMESTAMP(3),
    "optInRecordedByProfileId" TEXT,
    "optOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentContact_tenantId_id_key" ON "AppointmentContact"("tenantId", "id");

-- CreateIndex (one contact snapshot per appointment; also serves the
-- (tenantId, appointmentId) lookup and the FK to Appointment)
CREATE UNIQUE INDEX "AppointmentContact_tenantId_appointmentId_key" ON "AppointmentContact"("tenantId", "appointmentId");

-- AddForeignKey
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (composite: contact can only point at an appointment of the same tenant)
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_tenantId_appointmentId_fkey" FOREIGN KEY ("tenantId", "appointmentId") REFERENCES "Appointment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (composite: verbal opt-in recorder must be a profile of the
-- same tenant; MATCH SIMPLE, so rows with NULL recorder skip it). RESTRICT,
-- not SET NULL, for the same reason as ClosureDate.createdByProfileId.
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_tenantId_optInRecordedByProfileId_fkey" FOREIGN KEY ("tenantId", "optInRecordedByProfileId") REFERENCES "Profile"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual additions below are CHECKs and RLS, which `prisma migrate diff`
-- ignores (same as earlier migrations). No partial indexes (drift in
-- staging-migrate.yml, see WP-02c). Length caps are VARCHAR(n) above.
--
-- "Trimmed non-blank" = at least one non-whitespace char AND no leading or
-- trailing whitespace. Uses [[:space:]] (not btrim(), which strips only
-- spaces, so a tab-only value would pass it — WP-08 ClosureDate lesson).
-- A NULL operand makes a CHECK pass, so every nullable column is only
-- validated when set.
-- ---------------------------------------------------------------------------

-- Tenant (root table, intentionally not under RLS; no policy change).
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_legalName_trimmed_check"
  CHECK ("legalName" ~ '[^[:space:]]' AND "legalName" !~ '^[[:space:]]|[[:space:]]$');
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_legalAddress_trimmed_check"
  CHECK ("legalAddress" ~ '[^[:space:]]' AND "legalAddress" !~ '^[[:space:]]|[[:space:]]$');
-- Shape check only (no whitespace anywhere, exactly one '@' with text on both sides).
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_kvkkContactEmail_format_check"
  CHECK ("kvkkContactEmail" ~ '^[^@[:space:]]+@[^@[:space:]]+$');

-- AppointmentContact: field formats.
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_displayName_not_blank_check"
  CHECK ("displayName" ~ '[^[:space:]]');
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_email_format_check"
  CHECK ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+$');
-- Must equal TENANT_CONTACT_PHONE_PATTERN in src/domain/tenant.ts (E.164).
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_phone_e164_check"
  CHECK ("phone" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_noticeVersion_trimmed_check"
  CHECK ("noticeVersion" ~ '[^[:space:]]' AND "noticeVersion" !~ '^[[:space:]]|[[:space:]]$');
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_optInVersion_trimmed_check"
  CHECK ("optInVersion" ~ '[^[:space:]]' AND "optInVersion" !~ '^[[:space:]]|[[:space:]]$');
-- SHA-256 of the exact shown text, lowercase hex.
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_noticeHash_sha256_hex_check"
  CHECK ("noticeHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_optInHash_sha256_hex_check"
  CHECK ("optInHash" ~ '^[0-9a-f]{64}$');

-- AppointmentContact: record consistency.
-- Public form: the notice shown must be recorded; no staff recorder.
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_public_form_notice_check"
  CHECK ("source" <> 'PUBLIC_FORM' OR (
    "noticeVersion" IS NOT NULL AND "noticeHash" IS NOT NULL AND "noticeShownAt" IS NOT NULL
    AND "optInRecordedByProfileId" IS NULL));
-- Opt-in needs a destination phone and the exact opt-in text version/hash/time.
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_optin_requires_record_check"
  CHECK (NOT "whatsappOptIn" OR (
    "phone" IS NOT NULL AND "optInVersion" IS NOT NULL AND "optInHash" IS NOT NULL AND "optInAt" IS NOT NULL));
-- Staff-recorded (verbal) opt-in must name the recording staff profile.
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_staff_optin_recorder_check"
  CHECK ("source" <> 'STAFF' OR NOT "whatsappOptIn" OR "optInRecordedByProfileId" IS NOT NULL);
-- Without opt-in no opt-in/opt-out data may exist. Opt-out therefore keeps
-- "whatsappOptIn" = true and sets "optOutAt"; senders must require
-- "whatsappOptIn" AND "optOutAt" IS NULL.
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_no_optin_fields_without_optin_check"
  CHECK ("whatsappOptIn" OR (
    "optInVersion" IS NULL AND "optInHash" IS NULL AND "optInAt" IS NULL
    AND "optInRecordedByProfileId" IS NULL AND "optOutAt" IS NULL));
ALTER TABLE "AppointmentContact" ADD CONSTRAINT "AppointmentContact_optout_after_optin_check"
  CHECK ("optOutAt" IS NULL OR ("optInAt" IS NOT NULL AND "optOutAt" >= "optInAt"));

-- Tenant isolation (same pattern as AppointmentAccessToken / ClosureDate).
ALTER TABLE "AppointmentContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentContact" FORCE ROW LEVEL SECURITY;

CREATE POLICY "appointment_contact_tenant_isolation_select" ON "AppointmentContact"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "appointment_contact_tenant_isolation_insert" ON "AppointmentContact"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "appointment_contact_tenant_isolation_update" ON "AppointmentContact"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "appointment_contact_tenant_isolation_delete" ON "AppointmentContact"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

-- No GRANTs: existing tenant tables rely on default privileges of the runtime
-- role (no table GRANTs in prior migrations); keep consistent.

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only; must ship together with reverting the
-- schema.prisma change + app code). DESTROYS all KVKK notice records and
-- WhatsApp opt-in/opt-out evidence — export the table first if any real
-- bookings exist (legal record-keeping). After rollback no appointment has an
-- opt-in record, so customer WhatsApp must stay disabled.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS "AppointmentContact";
--   (drops policies, CHECKs, indexes and FKs with it; no other table references it)
-- DROP TYPE IF EXISTS "AppointmentContactSource";
-- ALTER TABLE "Tenant" DROP CONSTRAINT IF EXISTS "Tenant_legalName_trimmed_check",
--   DROP CONSTRAINT IF EXISTS "Tenant_legalAddress_trimmed_check",
--   DROP CONSTRAINT IF EXISTS "Tenant_kvkkContactEmail_format_check";
-- ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "legalName",
--   DROP COLUMN IF EXISTS "legalAddress", DROP COLUMN IF EXISTS "kvkkContactEmail";
