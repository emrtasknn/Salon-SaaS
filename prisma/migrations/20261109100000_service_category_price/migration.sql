-- Service categories + optional price (owner decision 2026-11-06).
-- PROPOSAL: validate in CI (isolated PostgreSQL 17) and on staging first; apply to
-- the pilot only with explicit owner approval, before merging the app code.
-- Ordering: after 20261108100000_appointment_rescheduled_notification.
-- Additive only: new nullable/defaulted columns on "Service" and a new table.
-- No backfill: existing services keep categoryId NULL ("Diğer") and no price.

-- AlterTable (matches `prisma migrate diff` output)
ALTER TABLE "Service" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "priceIsFrom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceMinor" INTEGER;

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceCategory_tenantId_idx" ON "ServiceCategory"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_tenantId_id_key" ON "ServiceCategory"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_tenantId_name_key" ON "ServiceCategory"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Service_tenantId_categoryId_idx" ON "Service"("tenantId", "categoryId");

-- AddForeignKey (composite: a service can only point at a category of the SAME
-- tenant; MATCH SIMPLE, so services with NULL "categoryId" skip it).
-- RESTRICT, not SET NULL: a composite SET NULL would also null the NOT NULL
-- "tenantId". The app clears "categoryId" on its services before deleting a
-- category, in one transaction.
ALTER TABLE "Service" ADD CONSTRAINT "Service_category_tenant_fkey" FOREIGN KEY ("tenantId", "categoryId") REFERENCES "ServiceCategory"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual additions below are CHECKs and RLS, which `prisma migrate diff`
-- ignores (same as earlier migrations).
-- ---------------------------------------------------------------------------

-- Price: kuruş, 0 .. 100.000,00 TL. "Starting price" needs a price.
ALTER TABLE "Service" ADD CONSTRAINT "Service_priceMinor_range_check"
  CHECK ("priceMinor" IS NULL OR ("priceMinor" >= 0 AND "priceMinor" <= 10000000));
ALTER TABLE "Service" ADD CONSTRAINT "Service_priceIsFrom_requires_price_check"
  CHECK ("priceIsFrom" = false OR "priceMinor" IS NOT NULL);

-- Category name must contain a non-whitespace character (length capped by VARCHAR(60)).
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_name_not_blank_check"
  CHECK ("name" ~ '[^[:space:]]');
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_sortOrder_range_check"
  CHECK ("sortOrder" >= 0 AND "sortOrder" <= 10000);

-- Tenant isolation (same pattern as ClosureDate / CustomerNote).
ALTER TABLE "ServiceCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceCategory" FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_category_tenant_isolation_select" ON "ServiceCategory"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "service_category_tenant_isolation_insert" ON "ServiceCategory"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "service_category_tenant_isolation_update" ON "ServiceCategory"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "service_category_tenant_isolation_delete" ON "ServiceCategory"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

-- No GRANTs: the runtime role (salon_app) receives table privileges through the
-- default privileges set in 20261107110000_salon_app_runtime_role.

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only; deletes all categories and prices).
-- Must ship together with reverting schema.prisma and the app code.
-- ---------------------------------------------------------------------------
-- ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS "Service_category_tenant_fkey";
-- ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS "Service_priceMinor_range_check";
-- ALTER TABLE "Service" DROP CONSTRAINT IF EXISTS "Service_priceIsFrom_requires_price_check";
-- DROP INDEX IF EXISTS "Service_tenantId_categoryId_idx";
-- ALTER TABLE "Service" DROP COLUMN IF EXISTS "categoryId", DROP COLUMN IF EXISTS "priceMinor", DROP COLUMN IF EXISTS "priceIsFrom";
-- DROP TABLE IF EXISTS "ServiceCategory";
