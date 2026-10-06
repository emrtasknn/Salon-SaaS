CREATE TYPE "NotificationEventType" AS ENUM ('APPOINTMENT_CREATED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_REJECTED');
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "eventType" "NotificationEventType" NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "recipientProfileId" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationDelivery_tenantId_id_key" ON "NotificationDelivery"("tenantId", "id");
CREATE UNIQUE INDEX "NotificationDelivery_idempotency_key"
  ON "NotificationDelivery"("tenantId", "appointmentId", "eventType", "channel", "recipientProfileId");
CREATE INDEX "NotificationDelivery_tenantId_status_createdAt_idx"
  ON "NotificationDelivery"("tenantId", "status", "createdAt");

ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_tenantId_appointmentId_fkey"
  FOREIGN KEY ("tenantId", "appointmentId") REFERENCES "Appointment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationDelivery" FORCE ROW LEVEL SECURITY;

CREATE POLICY "notification_delivery_tenant_isolation_select" ON "NotificationDelivery"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "notification_delivery_tenant_isolation_insert" ON "NotificationDelivery"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "notification_delivery_tenant_isolation_update" ON "NotificationDelivery"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "notification_delivery_tenant_isolation_delete" ON "NotificationDelivery"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));
