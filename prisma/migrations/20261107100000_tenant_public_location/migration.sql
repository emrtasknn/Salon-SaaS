-- Salon location (owner request 2026-11-05): customer-facing address and an optional
-- Google/Apple Maps share link on Tenant, shown on the public salon and booking pages
-- as a "Yol tarifi al" link. Separate from the KVKK "legalAddress".
-- PROPOSAL — apply only after owner approval, and validate in CI (isolated PostgreSQL 17) first.
-- Ordering: after 20261106100000_kvkk_notice_whatsapp_optin (WP-10).
-- Additive only: two nullable columns (all existing rows NULL, so the CHECKs cannot
-- fail on apply). No backfill. Tenant is the root table, intentionally not under RLS;
-- no policy change.
--
-- Rollback (only after the application no longer reads/writes the columns):
--   ALTER TABLE "Tenant" DROP CONSTRAINT IF EXISTS "Tenant_mapsUrl_allowlist_check";
--   ALTER TABLE "Tenant" DROP CONSTRAINT IF EXISTS "Tenant_publicAddress_trimmed_check";
--   ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "mapsUrl", DROP COLUMN IF EXISTS "publicAddress";

-- AlterTable (matches `prisma migrate diff` output for model Tenant)
ALTER TABLE "Tenant" ADD COLUMN     "mapsUrl" VARCHAR(500),
ADD COLUMN     "publicAddress" VARCHAR(300);

-- ---------------------------------------------------------------------------
-- Manual additions below are CHECKs, which `prisma migrate diff` ignores
-- (same as earlier migrations). A NULL operand makes a CHECK pass, so each
-- nullable column is only validated when set.
-- ---------------------------------------------------------------------------

-- "Trimmed non-blank" with [[:space:]] (same rule as Tenant_legalAddress_trimmed_check).
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_publicAddress_trimmed_check"
  CHECK ("publicAddress" ~ '[^[:space:]]' AND "publicAddress" !~ '^[[:space:]]|[[:space:]]$');

-- Maps link allowlist (defence in depth for the domain validator; must stay identical to
-- TENANT_MAPS_URL_PATTERN in src/domain/tenant.ts): https only, no userinfo or port
-- (the host must follow "https://" directly and be followed by "/", "?", "#" or the end),
-- no whitespace; generic Google hosts only under the /maps path. Case-sensitive: the
-- application stores the URL-normalized (lower-case scheme/host) form.
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_mapsUrl_allowlist_check"
  CHECK ("mapsUrl" ~ '^https://(maps\.app\.goo\.gl|maps\.google\.com|maps\.apple\.com|goo\.gl/maps|(www\.)?google\.com/maps|www\.google\.com\.tr/maps)([/?#][^[:space:]]*)?$');
