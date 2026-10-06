CREATE TABLE "CustomerNote" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerProfileId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerNote_tenantId_id_key" ON "CustomerNote"("tenantId", "id");
CREATE INDEX "CustomerNote_tenantId_customerProfileId_createdAt_idx"
  ON "CustomerNote"("tenantId", "customerProfileId", "createdAt");

ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_tenantId_customerProfileId_fkey"
  FOREIGN KEY ("tenantId", "customerProfileId") REFERENCES "Profile"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerNote" FORCE ROW LEVEL SECURITY;

CREATE POLICY "customer_note_tenant_isolation_select" ON "CustomerNote"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "customer_note_tenant_isolation_insert" ON "CustomerNote"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "customer_note_tenant_isolation_update" ON "CustomerNote"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "customer_note_tenant_isolation_delete" ON "CustomerNote"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));
