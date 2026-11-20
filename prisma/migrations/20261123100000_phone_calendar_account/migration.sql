-- ADR-045 phase C (owner decision 2026-11-20): RandevuN CalDAV calendar account for iPhone /
-- Mac / Android (DAVx5). App appointments are served into it; events created in it are stored
-- here and act as busy time. Passwords are app-generated and stored only as scrypt hashes.
-- Apply to staging, then the pilot (docs/STAGING_RUNBOOK.md), then label the PR `pilot-migrated`.
-- Additive only: two new tables. No changes to existing tables or data.

-- CreateTable
CREATE TABLE "PhoneCalendarAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "username" VARCHAR(120) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneCalendarAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneCalendarEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "staffId" TEXT,
    "href" VARCHAR(255) NOT NULL,
    "uid" VARCHAR(255) NOT NULL,
    "etag" VARCHAR(80) NOT NULL,
    "ics" TEXT NOT NULL,
    "title" VARCHAR(200),
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "blocksTime" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhoneCalendarAccount_tenantId_profileId_revokedAt_idx" ON "PhoneCalendarAccount"("tenantId", "profileId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneCalendarAccount_tenantId_id_key" ON "PhoneCalendarAccount"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneCalendarAccount_tenantId_username_key" ON "PhoneCalendarAccount"("tenantId", "username");

-- CreateIndex
CREATE INDEX "PhoneCalendarEvent_tenantId_staffId_startAt_idx" ON "PhoneCalendarEvent"("tenantId", "staffId", "startAt");

-- CreateIndex
CREATE INDEX "PhoneCalendarEvent_tenantId_accountId_updatedAt_idx" ON "PhoneCalendarEvent"("tenantId", "accountId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneCalendarEvent_tenantId_id_key" ON "PhoneCalendarEvent"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneCalendarEvent_tenantId_accountId_href_key" ON "PhoneCalendarEvent"("tenantId", "accountId", "href");

-- AddForeignKey
ALTER TABLE "PhoneCalendarAccount" ADD CONSTRAINT "PhoneCalendarAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneCalendarAccount" ADD CONSTRAINT "PhoneCalendarAccount_profile_tenant_fkey" FOREIGN KEY ("tenantId", "profileId") REFERENCES "Profile"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneCalendarEvent" ADD CONSTRAINT "PhoneCalendarEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneCalendarEvent" ADD CONSTRAINT "PhoneCalendarEvent_account_tenant_fkey" FOREIGN KEY ("tenantId", "accountId") REFERENCES "PhoneCalendarAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneCalendarEvent" ADD CONSTRAINT "PhoneCalendarEvent_staff_tenant_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "Staff"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Manual additions below are invisible to Prisma.
-- ---------------------------------------------------------------------------

-- "<8 lowercase alphanumerics>.<tenant slug>" — the slug part routes Basic auth to a tenant.
ALTER TABLE "PhoneCalendarAccount" ADD CONSTRAINT "PhoneCalendarAccount_username_format_check"
  CHECK ("username" ~ '^[a-z0-9]{8}\.[a-z0-9-]+$');
-- "scrypt$<N>$<salt b64url>$<hash b64url>"; never a plain password.
ALTER TABLE "PhoneCalendarAccount" ADD CONSTRAINT "PhoneCalendarAccount_passwordHash_format_check"
  CHECK ("passwordHash" ~ '^scrypt\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$');
-- At most one live account per profile (a new one revokes the old one first).
CREATE UNIQUE INDEX "PhoneCalendarAccount_one_live_per_profile"
  ON "PhoneCalendarAccount"("tenantId", "profileId") WHERE "revokedAt" IS NULL;

ALTER TABLE "PhoneCalendarEvent" ADD CONSTRAINT "PhoneCalendarEvent_interval_check" CHECK ("endAt" > "startAt");
ALTER TABLE "PhoneCalendarEvent" ADD CONSTRAINT "PhoneCalendarEvent_ics_size_check" CHECK (octet_length("ics") <= 65536);
ALTER TABLE "PhoneCalendarEvent" ADD CONSTRAINT "PhoneCalendarEvent_href_format_check" CHECK ("href" ~ '^[A-Za-z0-9._@%+-]{1,255}$');

ALTER TABLE "PhoneCalendarAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PhoneCalendarAccount" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PhoneCalendarEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PhoneCalendarEvent" FORCE ROW LEVEL SECURITY;

CREATE POLICY "phone_calendar_account_tenant_isolation_select" ON "PhoneCalendarAccount"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "phone_calendar_account_tenant_isolation_insert" ON "PhoneCalendarAccount"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "phone_calendar_account_tenant_isolation_update" ON "PhoneCalendarAccount"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "phone_calendar_account_tenant_isolation_delete" ON "PhoneCalendarAccount"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

CREATE POLICY "phone_calendar_event_tenant_isolation_select" ON "PhoneCalendarEvent"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "phone_calendar_event_tenant_isolation_insert" ON "PhoneCalendarEvent"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "phone_calendar_event_tenant_isolation_update" ON "PhoneCalendarEvent"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "phone_calendar_event_tenant_isolation_delete" ON "PhoneCalendarEvent"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

-- No GRANTs: salon_app gets table privileges through default privileges (20261107110000).

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only; every phone loses the RandevuN account and the
-- events created in it). Ship together with reverting schema.prisma + app code.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS "PhoneCalendarEvent";
-- DROP TABLE IF EXISTS "PhoneCalendarAccount";
