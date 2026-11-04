-- WP-08: closed dates (tenant-wide or per staff), tenant-scoped under RLS.
-- PROPOSAL — apply only after owner approval, and validate in CI (isolated PostgreSQL 17) first.
-- Ordering: after 20261104120000_tenant_status_contact_phone (WP-07).
-- Additive only: no changes to existing tables, columns, enums or data. No backfill.
-- "date" is the LOCAL calendar date in the tenant's timezone (DATE, no instant).

-- CreateTable (matches `prisma migrate diff` output for model ClosureDate)
CREATE TABLE "ClosureDate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "staffId" TEXT,
    "date" DATE NOT NULL,
    "reason" VARCHAR(200),
    "createdByProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClosureDate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClosureDate_tenantId_id_key" ON "ClosureDate"("tenantId", "id");

-- CreateIndex (at most one per-staff closure per staff per local date; NULL
-- "staffId" rows never collide in PostgreSQL, so tenant-wide rows are unaffected)
CREATE UNIQUE INDEX "ClosureDate_tenantId_staffId_date_key" ON "ClosureDate"("tenantId", "staffId", "date");

-- CreateIndex (range lookup: closures for a tenant over the availability window)
CREATE INDEX "ClosureDate_tenantId_date_idx" ON "ClosureDate"("tenantId", "date");

-- AddForeignKey
ALTER TABLE "ClosureDate" ADD CONSTRAINT "ClosureDate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (composite: a per-staff closure can only point at staff of the
-- same tenant; MATCH SIMPLE, so tenant-wide rows with NULL "staffId" skip it)
ALTER TABLE "ClosureDate" ADD CONSTRAINT "ClosureDate_tenantId_staffId_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "Staff"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (composite: creator must be a profile of the same tenant).
-- RESTRICT, not SET NULL: a composite SET NULL would also null the NOT NULL
-- "tenantId"; column-list SET NULL (PG 15+) is not representable in Prisma.
-- Profiles are never hard-deleted by the app, matching every other FK here.
ALTER TABLE "ClosureDate" ADD CONSTRAINT "ClosureDate_tenantId_createdByProfileId_fkey" FOREIGN KEY ("tenantId", "createdByProfileId") REFERENCES "Profile"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual additions below are a CHECK and RLS, which `prisma migrate diff`
-- ignores (same as earlier migrations). No partial indexes: a SQL-only index
-- would show as drift in staging-migrate.yml (see WP-02c). "One tenant-wide
-- closure per date" is enforced by the app: closure create locks the Tenant
-- row FOR UPDATE, then checks for an existing row, then inserts, in one tx.
-- A duplicate would be harmless anyway (a closed date is closed either way).
-- ---------------------------------------------------------------------------

-- Optional reason must not be blank/whitespace-only (length capped by VARCHAR(200)).
ALTER TABLE "ClosureDate" ADD CONSTRAINT "ClosureDate_reason_not_blank_check"
  CHECK ("reason" IS NULL OR btrim("reason") <> '');

-- Tenant isolation (same pattern as AppointmentAccessToken / NotificationDelivery / CustomerNote).
ALTER TABLE "ClosureDate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClosureDate" FORCE ROW LEVEL SECURITY;

CREATE POLICY "closure_date_tenant_isolation_select" ON "ClosureDate"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "closure_date_tenant_isolation_insert" ON "ClosureDate"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "closure_date_tenant_isolation_update" ON "ClosureDate"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "closure_date_tenant_isolation_delete" ON "ClosureDate"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

-- No GRANTs: existing tenant tables rely on default privileges of the runtime
-- role (no table GRANTs in prior migrations); keep consistent.

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only; deletes all closures, which makes
-- previously closed dates bookable again). Must ship together with reverting
-- the schema.prisma model/back-relations + app code (availability/booking
-- closure checks, admin closures UI).
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS "ClosureDate";
--   (drops policies, CHECK, indexes and FKs with it; no other
--    table references it)
