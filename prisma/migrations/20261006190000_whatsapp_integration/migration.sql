CREATE TABLE "WhatsAppIntegration" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "phoneNumberId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhatsAppIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppIntegration_tenantId_id_key"
  ON "WhatsAppIntegration"("tenantId", "id");
CREATE UNIQUE INDEX "WhatsAppIntegration_provider_phoneNumberId_key"
  ON "WhatsAppIntegration"("provider", "phoneNumberId");
CREATE INDEX "WhatsAppIntegration_tenantId_status_idx"
  ON "WhatsAppIntegration"("tenantId", "status");

ALTER TABLE "WhatsAppIntegration"
  ADD CONSTRAINT "WhatsAppIntegration_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WhatsAppIntegration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppIntegration" FORCE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_integration_tenant_isolation_select" ON "WhatsAppIntegration"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "whatsapp_integration_tenant_isolation_insert" ON "WhatsAppIntegration"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "whatsapp_integration_tenant_isolation_update" ON "WhatsAppIntegration"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "whatsapp_integration_tenant_isolation_delete" ON "WhatsAppIntegration"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.resolve_whatsapp_tenant_id(p_phone_number_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT "tenantId"
  FROM public."WhatsAppIntegration"
  WHERE "provider" = 'META_WHATSAPP'
    AND "phoneNumberId" = p_phone_number_id
    AND "status" = 'ACTIVE'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION private.resolve_whatsapp_tenant_id(TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO postgres;
GRANT EXECUTE ON FUNCTION private.resolve_whatsapp_tenant_id(TEXT) TO postgres;
