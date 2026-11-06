-- Multi-service appointments (owner decision 2026-11-06: same staff, services back to back).
-- PROPOSAL: validate in CI (isolated PostgreSQL 17) and on staging first; apply to
-- the pilot only with explicit owner approval, before merging the app code.
-- Ordering: after 20261110100000_staff_service_mapping.
-- Additive only: one new table, no change to existing rows (no backfill).
-- Semantics: rows exist only for appointments with 2+ services; position 0 equals
-- "Appointment"."serviceId"; "Appointment"."endAt" covers sum(duration + buffer).

-- CreateTable (matches `prisma migrate diff` output)
CREATE TABLE "AppointmentService" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentService_tenantId_serviceId_idx" ON "AppointmentService"("tenantId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentService_tenantId_id_key" ON "AppointmentService"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentService_tenantId_appointmentId_position_key" ON "AppointmentService"("tenantId", "appointmentId", "position");

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (composite, same tenant). Appointments are never hard-deleted by the app;
-- CASCADE only keeps a manual cleanup simple and never nulls "tenantId".
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_appointment_tenant_fkey" FOREIGN KEY ("tenantId", "appointmentId") REFERENCES "Appointment"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (composite, same tenant; RESTRICT like "Appointment"."serviceId").
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_service_tenant_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual additions below: CHECK and RLS, which `prisma migrate diff` ignores.
-- ---------------------------------------------------------------------------

-- Up to 5 services per appointment (positions 0..4).
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_position_range_check"
  CHECK ("position" >= 0 AND "position" <= 4);

-- Tenant isolation (same pattern as ServiceCategory / StaffService).
ALTER TABLE "AppointmentService" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentService" FORCE ROW LEVEL SECURITY;

CREATE POLICY "appointment_service_tenant_isolation_select" ON "AppointmentService"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "appointment_service_tenant_isolation_insert" ON "AppointmentService"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "appointment_service_tenant_isolation_update" ON "AppointmentService"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "appointment_service_tenant_isolation_delete" ON "AppointmentService"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

-- No GRANTs: the runtime role (salon_app) receives table privileges through the
-- default privileges set in 20261107110000_salon_app_runtime_role.

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only). Multi-service appointments keep their
-- first service and full time range; only the list of extra services is lost.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS "AppointmentService";
