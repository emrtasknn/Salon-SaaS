CREATE TABLE "WorkingHours" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "openMinute" INTEGER NOT NULL,
  "closeMinute" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkingHours_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkingHours_tenantId_id_key" ON "WorkingHours"("tenantId", "id");
CREATE UNIQUE INDEX "WorkingHours_tenantId_dayOfWeek_key" ON "WorkingHours"("tenantId", "dayOfWeek");
CREATE INDEX "WorkingHours_tenantId_idx" ON "WorkingHours"("tenantId");

ALTER TABLE "WorkingHours" ADD CONSTRAINT "WorkingHours_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkingHours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkingHours" FORCE ROW LEVEL SECURITY;

CREATE POLICY "working_hours_tenant_isolation_select" ON "WorkingHours"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY "working_hours_tenant_isolation_insert" ON "WorkingHours"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY "working_hours_tenant_isolation_update" ON "WorkingHours"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY "working_hours_tenant_isolation_delete" ON "WorkingHours"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));
