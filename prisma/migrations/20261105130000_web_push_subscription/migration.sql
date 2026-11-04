-- WP-09 / ADR-044 §4 + §7 (phase 3): Web Push channel and per-device push
-- subscriptions for STAFF / TENANT_ADMIN profiles, tenant-scoped under RLS.
-- PROPOSAL — apply only after owner approval, and validate in CI (isolated PostgreSQL 17) first.
-- Ordering: last in the schema line, after WP-08 20261105120000_closure_date.
-- Additive only: one new enum value, one new table. No changes to existing
-- tables, columns or data. No backfill.

-- AlterEnum
-- PostgreSQL >= 12 allows ADD VALUE inside a transaction block as long as the
-- new value is not used in the same transaction. Nothing below references
-- 'WEB_PUSH' (no default, CHECK, policy or data write uses it).
-- Irreversible: PostgreSQL cannot drop an enum value (see rollback note).
ALTER TYPE "NotificationChannel" ADD VALUE 'WEB_PUSH';

-- CreateTable (matches `prisma migrate diff` output for model PushSubscription)
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_tenantId_id_key" ON "PushSubscription"("tenantId", "id");

-- CreateIndex (one row per browser endpoint per tenant; re-subscribe by another
-- profile of the same tenant reassigns in place. Deliberately NOT globally
-- unique: under tenant RLS a global unique would raise P2002 for a row the
-- caller cannot see, leaking cross-tenant existence.)
CREATE UNIQUE INDEX "PushSubscription_tenantId_endpoint_key" ON "PushSubscription"("tenantId", "endpoint");

-- CreateIndex (send-time lookup: active subscriptions of a recipient profile)
CREATE INDEX "PushSubscription_tenantId_profileId_revokedAt_idx" ON "PushSubscription"("tenantId", "profileId", "revokedAt");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (composite: a subscription can only belong to a profile of the same tenant)
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_tenantId_profileId_fkey" FOREIGN KEY ("tenantId", "profileId") REFERENCES "Profile"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual additions below are invisible to Prisma (not representable in
-- schema.prisma; `prisma migrate diff` neither generates nor drops them).
-- ---------------------------------------------------------------------------

-- Push service endpoints must be absolute https URLs of bounded length.
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_endpoint_https_check"
  CHECK ("endpoint" LIKE 'https://%' AND char_length("endpoint") <= 2048);

-- RFC 8291 keys as unpadded base64url: p256dh = 65-byte uncompressed P-256
-- point (87 chars), auth = 16-byte secret (22 chars). Bounds leave slack; the
-- app validates exact decoded lengths and strips '=' padding before insert.
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_p256dh_base64url_check"
  CHECK ("p256dh" ~ '^[A-Za-z0-9_-]{80,100}$');
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_auth_base64url_check"
  CHECK ("auth" ~ '^[A-Za-z0-9_-]{16,32}$');

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userAgent_length_check"
  CHECK ("userAgent" IS NULL OR char_length("userAgent") <= 256);

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_failureCount_nonnegative_check"
  CHECK ("failureCount" >= 0);

-- Tenant isolation (same pattern as AppointmentAccessToken / NotificationDelivery).
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushSubscription" FORCE ROW LEVEL SECURITY;

CREATE POLICY "push_subscription_tenant_isolation_select" ON "PushSubscription"
  FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "push_subscription_tenant_isolation_insert" ON "PushSubscription"
  FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "push_subscription_tenant_isolation_update" ON "PushSubscription"
  FOR UPDATE USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
CREATE POLICY "push_subscription_tenant_isolation_delete" ON "PushSubscription"
  FOR DELETE USING ("tenantId" = current_setting('app.tenant_id', true));

-- No GRANTs: existing tenant tables rely on default privileges of the runtime
-- role (no table GRANTs in prior migrations); keep consistent.

-- ---------------------------------------------------------------------------
-- Rollback (manual, owner-approved only; destroys all push subscriptions, so
-- every device must re-subscribe; WhatsApp delivery is unaffected).
-- Must ship together with reverting the schema.prisma model + app code.
-- ---------------------------------------------------------------------------
-- DROP TABLE IF EXISTS "PushSubscription";
--   (drops policies, CHECKs, indexes and FKs with it; no other table references it)
-- The enum value 'WEB_PUSH' CANNOT be dropped by PostgreSQL; it stays unused
-- and harmless. Before reverting app code, confirm no NotificationDelivery row
-- has channel = 'WEB_PUSH' (or keep 'WEB_PUSH' in schema.prisma so the old
-- client can still read such rows; removing it from the schema would make
-- `prisma migrate diff` attempt an enum recreate).
