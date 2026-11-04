-- WP-06 / ADR-044 §5: customer status-link token (hash only), tenant-scoped under RLS.
-- PROPOSAL — apply only after owner approval, and validate in CI (isolated PostgreSQL 17) first.
-- Ordering: after 20261104100000_rate_limit (WP-05), before WP-07.
-- Additive only: no changes to existing tables, columns, enums or data. No backfill.

-- CreateTable (matches `prisma migrate diff` output for model AppointmentAccessToken)
CREATE TABLE "AppointmentAccessToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentAccessToken_tenantId_id_key" ON "AppointmentAccessToken"("tenantId", "id");

-- CreateIndex (one token per appointment; reissue rotates tokenHash in place)
CREATE UNIQUE INDEX "AppointmentAccessToken_tenantId_appointmentId_key" ON "AppointmentAccessToken"("tenantId", "appointmentId");

-- CreateIndex (lookup path: tenant from slug, then sha256(token) under RLS)
CREATE UNIQUE INDEX "AppointmentAccessToken_tenantId_tokenHash_key" ON "AppointmentAccessToken"("tenantId", "tokenHash");

-- AddForeignKey
ALTER TABLE "AppointmentAccessToken" ADD CONSTRAINT "AppointmentAccessToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (composite: token can only point at an appointment of the same tenant)
ALTER TABLE "AppointmentAccessToken" ADD CONSTRAINT "AppointmentAccessToken_tenantId_appointmentId_fkey" FOREIGN KEY ("tenantId", "appointmentId") REFERENCES "Appointment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual additions below are invisible to Prisma (not representable in
-- schema.prisma; `prisma migrate diff` neither generates nor drops them).
-- ---------------------------------------------------------------------------

-- Only a SHA-256 digest in lowercase hex may be stored; rejects raw tokens
-- (base64url, 43 chars) and uppercase/other encodings.
ALTER TABLE "AppointmentAccessToken" ADD CONSTRAINT "AppointmentAccessToken_tokenHash_sha256_hex_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

-- Tenant isolation (same pattern as NotificationDelivery / CustomerNote).
ALTER TABLE "AppointmentAccessToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentAccessToken" FORCE ROW LEVEL SECURITY;

CREATE POLICY "appointment_access_token_tenant_isolation_select" ON "AppointmentAccessToken"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "appointment_access_token_tenant_isolation_insert" ON "AppointmentAccessToken"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "appointment_access_token_tenant_isolation_update" ON "AppointmentAccessToken"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "appointment_access_token_tenant_isolation_delete" ON "AppointmentAccessToken"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

-- No GRANTs: existing tenant tables rely on default privileges of the runtime
-- role (no table GRANTs in prior migrations); keep consistent.

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only; destroys all status links, which
-- simply makes existing links show the generic "invalid or expired" page).
-- Must ship together with reverting the schema.prisma model + app code.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS "AppointmentAccessToken";
--   (drops policies, CHECK, indexes and FKs with it; no other table references it)
