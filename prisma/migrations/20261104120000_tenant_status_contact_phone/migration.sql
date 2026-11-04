-- WP-07: tenant active/inactive status + public contact phone (wa.me CTA).
-- PROPOSAL — apply only after owner approval, and validate in CI (isolated PostgreSQL 17) first.
-- Ordering: after 20261104110000_appointment_access_token (WP-06).
-- Additive only. Existing tenants become ACTIVE via the column default
-- (PostgreSQL 11+: constant default, metadata-only, no table rewrite).
-- "timezone" is intentionally untouched (owner decision (d): not editable; default Europe/Istanbul).

-- CreateEnum (matches `prisma migrate diff` output for enum TenantStatus)
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable (matches `prisma migrate diff` output for model Tenant)
ALTER TABLE "Tenant" ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Manual additions below are invisible to Prisma (not representable in
-- schema.prisma; `prisma migrate diff` neither generates nor drops them).
-- ---------------------------------------------------------------------------

-- E.164 only: leading '+', no leading zero country code, 7–15 digits total.
-- NULL means "no phone" (CTA hidden). All existing rows are NULL, so
-- validation cannot fail on apply.
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_contactPhone_e164_check"
  CHECK ("contactPhone" ~ '^\+[1-9][0-9]{6,14}$');

-- RLS / grants: none changed. "Tenant" is the root table and is intentionally
-- not under RLS (docs/RLS_TENANT_ISOLATION.md); tenant-owned tables keep their
-- existing policies. No GRANTs, consistent with prior migrations.

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only; must ship together with reverting the
-- schema.prisma change + app code). Destroys stored contact phones and the
-- status flag — any INACTIVE tenant becomes bookable again after rollback.
-- ---------------------------------------------------------------------------
-- ALTER TABLE "Tenant" DROP CONSTRAINT IF EXISTS "Tenant_contactPhone_e164_check";
-- ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "contactPhone";
-- DROP TYPE IF EXISTS "TenantStatus";
