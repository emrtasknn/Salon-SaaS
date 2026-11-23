-- ADR-045 phase B: Google Calendar two-way sync (owner-approved 2026-11-19: Google busy time
-- closes online booking only; manual creation is not blocked).
-- Apply to staging, then the pilot (docs/STAGING_RUNBOOK.md), then label the PR `pilot-migrated`.
-- Additive only: two enums, three tables. No changes to existing tables or data.

-- CreateEnum
CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE');

-- CreateEnum
CREATE TYPE "CalendarConnectionStatus" AS ENUM ('ACTIVE', 'ERROR', 'REVOKED');

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "provider" "CalendarProvider" NOT NULL,
    "status" "CalendarConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "accountEmail" VARCHAR(254),
    "refreshTokenEnc" TEXT NOT NULL,
    "calendarId" VARCHAR(1024) NOT NULL,
    "busyCalendarIds" TEXT[] DEFAULT ARRAY['primary']::TEXT[],
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(64),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalBusyBlock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalBusyBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "externalEventId" VARCHAR(1024) NOT NULL,
    "syncedUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarConnection_tenantId_profileId_provider_status_idx" ON "CalendarConnection"("tenantId", "profileId", "provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_tenantId_id_key" ON "CalendarConnection"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ExternalBusyBlock_tenantId_staffId_startAt_idx" ON "ExternalBusyBlock"("tenantId", "staffId", "startAt");

-- CreateIndex
CREATE INDEX "ExternalBusyBlock_tenantId_connectionId_idx" ON "ExternalBusyBlock"("tenantId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalBusyBlock_tenantId_id_key" ON "ExternalBusyBlock"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventLink_tenantId_id_key" ON "CalendarEventLink"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventLink_tenantId_connectionId_appointmentId_key" ON "CalendarEventLink"("tenantId", "connectionId", "appointmentId");

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_profile_tenant_fkey" FOREIGN KEY ("tenantId", "profileId") REFERENCES "Profile"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalBusyBlock" ADD CONSTRAINT "ExternalBusyBlock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalBusyBlock" ADD CONSTRAINT "ExternalBusyBlock_staff_tenant_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "Staff"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalBusyBlock" ADD CONSTRAINT "ExternalBusyBlock_connection_tenant_fkey" FOREIGN KEY ("tenantId", "connectionId") REFERENCES "CalendarConnection"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_connection_tenant_fkey" FOREIGN KEY ("tenantId", "connectionId") REFERENCES "CalendarConnection"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_appointment_tenant_fkey" FOREIGN KEY ("tenantId", "appointmentId") REFERENCES "Appointment"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Manual additions below are invisible to Prisma.
-- ---------------------------------------------------------------------------

-- At most one live (ACTIVE or ERROR) connection per profile and provider.
CREATE UNIQUE INDEX "CalendarConnection_one_live_per_profile_provider"
  ON "CalendarConnection"("tenantId", "profileId", "provider") WHERE "status" <> 'REVOKED';

-- The refresh token is stored only as "v1.<iv>.<ciphertext>.<tag>" (base64url, AES-256-GCM).
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_refreshTokenEnc_format_check"
  CHECK ("refreshTokenEnc" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_busyCalendarIds_bounds_check"
  CHECK (cardinality("busyCalendarIds") BETWEEN 0 AND 20);

ALTER TABLE "ExternalBusyBlock" ADD CONSTRAINT "ExternalBusyBlock_interval_check" CHECK ("endAt" > "startAt");

-- Tenant isolation (same pattern as PushSubscription / CalendarFeedToken).
ALTER TABLE "CalendarConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarConnection" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ExternalBusyBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalBusyBlock" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEventLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEventLink" FORCE ROW LEVEL SECURITY;

CREATE POLICY "calendar_connection_tenant_isolation_select" ON "CalendarConnection"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "calendar_connection_tenant_isolation_insert" ON "CalendarConnection"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "calendar_connection_tenant_isolation_update" ON "CalendarConnection"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "calendar_connection_tenant_isolation_delete" ON "CalendarConnection"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY "external_busy_block_tenant_isolation_select" ON "ExternalBusyBlock"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "external_busy_block_tenant_isolation_insert" ON "ExternalBusyBlock"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "external_busy_block_tenant_isolation_update" ON "ExternalBusyBlock"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "external_busy_block_tenant_isolation_delete" ON "ExternalBusyBlock"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY "calendar_event_link_tenant_isolation_select" ON "CalendarEventLink"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "calendar_event_link_tenant_isolation_insert" ON "CalendarEventLink"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "calendar_event_link_tenant_isolation_update" ON "CalendarEventLink"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "calendar_event_link_tenant_isolation_delete" ON "CalendarEventLink"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

-- No GRANTs: the runtime role (salon_app) gets table privileges through default privileges
-- (20261107110000_salon_app_runtime_role).

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only; disconnects every Google calendar; busy blocks stop
-- affecting online booking). Ship together with reverting schema.prisma + app code.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS "CalendarEventLink";
-- DROP TABLE IF EXISTS "ExternalBusyBlock";
-- DROP TABLE IF EXISTS "CalendarConnection";
-- DROP TYPE IF EXISTS "CalendarConnectionStatus";
-- DROP TYPE IF EXISTS "CalendarProvider";
