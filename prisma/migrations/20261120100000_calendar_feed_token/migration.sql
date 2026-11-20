-- ADR-045 phase A: private iCalendar subscription feed tokens (one active token per
-- profile and scope), tenant-scoped under RLS.
-- Owner-approved direction 2026-11-19 (customer names may appear in the phone calendar).
-- Apply to staging, then the pilot (docs/STAGING_RUNBOOK.md), then label the PR `pilot-migrated`.
-- Additive only: one new enum, one new table. No changes to existing tables or data.

-- CreateEnum
CREATE TYPE "CalendarFeedScope" AS ENUM ('STAFF_SELF', 'TENANT_ALL');

-- CreateTable
CREATE TABLE "CalendarFeedToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "scope" "CalendarFeedScope" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarFeedToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeedToken_tenantId_id_key" ON "CalendarFeedToken"("tenantId", "id");

-- CreateIndex (lookup by hash inside the slug-resolved tenant; tenant-scoped on purpose so a
-- unique violation can never reveal a row of another tenant under RLS)
CREATE UNIQUE INDEX "CalendarFeedToken_tenantId_tokenHash_key" ON "CalendarFeedToken"("tenantId", "tokenHash");

-- CreateIndex (active token of a profile and scope)
CREATE INDEX "CalendarFeedToken_tenantId_profileId_scope_revokedAt_idx" ON "CalendarFeedToken"("tenantId", "profileId", "scope", "revokedAt");

-- AddForeignKey
ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (composite: a token can only belong to a profile of the same tenant)
ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_profile_tenant_fkey" FOREIGN KEY ("tenantId", "profileId") REFERENCES "Profile"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual additions below are invisible to Prisma.
-- ---------------------------------------------------------------------------

-- Only a lowercase hex SHA-256 is ever stored, never the raw token.
ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_tokenHash_sha256_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

-- At most one active token per profile and scope (issuing a new one revokes the old one first).
CREATE UNIQUE INDEX "CalendarFeedToken_one_active_per_profile_scope"
  ON "CalendarFeedToken"("tenantId", "profileId", "scope") WHERE "revokedAt" IS NULL;

-- Tenant isolation (same pattern as PushSubscription / AppointmentAccessToken).
ALTER TABLE "CalendarFeedToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarFeedToken" FORCE ROW LEVEL SECURITY;

CREATE POLICY "calendar_feed_token_tenant_isolation_select" ON "CalendarFeedToken"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "calendar_feed_token_tenant_isolation_insert" ON "CalendarFeedToken"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "calendar_feed_token_tenant_isolation_update" ON "CalendarFeedToken"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "calendar_feed_token_tenant_isolation_delete" ON "CalendarFeedToken"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

-- No GRANTs: the runtime role (salon_app) gets table privileges through the default
-- privileges set in 20261107110000_salon_app_runtime_role.

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only; every subscribed phone calendar stops updating
-- and users must create a new link). Ship together with reverting schema.prisma + app code.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS "CalendarFeedToken";
-- DROP TYPE IF EXISTS "CalendarFeedScope";
