-- Staff–service mapping (owner decision 2026-11-06).
-- PROPOSAL: validate in CI (isolated PostgreSQL 17) and on staging first; apply to
-- the pilot only with explicit owner approval, before merging the app code.
-- Ordering: after 20261109100000_service_category_price.
-- Additive only: one new table, no change to existing rows.
-- Semantics: a staff member with NO rows performs every service (existing salons
-- are unchanged); with rows, only those services.

-- CreateTable (matches `prisma migrate diff` output)
CREATE TABLE "StaffService" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffService_tenantId_serviceId_idx" ON "StaffService"("tenantId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffService_tenantId_id_key" ON "StaffService"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StaffService_tenantId_staffId_serviceId_key" ON "StaffService"("tenantId", "staffId", "serviceId");

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (composite: staff and service must belong to the SAME tenant as the row.
-- CASCADE is safe here: deleting the staff/service row deletes the mapping row; it never
-- nulls "tenantId".)
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_staff_tenant_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "Staff"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_service_tenant_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual additions below: RLS, which `prisma migrate diff` ignores.
-- ---------------------------------------------------------------------------

-- Tenant isolation (same pattern as ServiceCategory / ClosureDate / CustomerNote).
ALTER TABLE "StaffService" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffService" FORCE ROW LEVEL SECURITY;

CREATE POLICY "staff_service_tenant_isolation_select" ON "StaffService"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "staff_service_tenant_isolation_insert" ON "StaffService"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "staff_service_tenant_isolation_update" ON "StaffService"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "staff_service_tenant_isolation_delete" ON "StaffService"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

-- No GRANTs: the runtime role (salon_app) receives table privileges through the
-- default privileges set in 20261107110000_salon_app_runtime_role.

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only; deletes all mappings, which restores
-- "every staff member performs every service"). Ship with reverting the app code.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS "StaffService";
