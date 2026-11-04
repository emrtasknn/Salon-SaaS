-- WP-02c: status-webhook tenant routing under the shared WhatsApp sender
-- (docs/tasks/WP-02c.md, Option A). Owner-approved 2026-11-04: amend the
-- W11.6 rule for this single wamid-keyed pre-tenant lookup; non-unique index on
-- NotificationDelivery.providerMessageId; unresolved statuses -> HTTP 200 + log.
-- CI validation only; Pilot/production apply needs separate approval and the
-- read-only pre-rollout gate (function owner rolbypassrls, EXECUTE grants,
-- live runtime role).
--
-- Rollback (no data migration; no business data is lost):
--   DROP FUNCTION IF EXISTS private.resolve_whatsapp_delivery_tenant_id(TEXT);
--   DROP INDEX IF EXISTS "NotificationDelivery_providerMessageId_idx";
--   (and remove @@index([providerMessageId]) from prisma/schema.prisma)
--
-- Unchanged: RLS (ENABLE + FORCE and policies) on NotificationDelivery and
-- WhatsAppIntegration, WhatsAppIntegration constraints, and
-- private.resolve_whatsapp_tenant_id. providerMessageId stays non-unique.

-- Non-unique index; name matches Prisma's default for @@index([providerMessageId]).
-- Without a tenantId prefix the resolver would otherwise scan the whole table
-- on every webhook. Plain CREATE INDEX (brief write lock) is acceptable at
-- pilot scale; use CONCURRENTLY in a separate migration if the table is large.
CREATE INDEX "NotificationDelivery_providerMessageId_idx"
  ON "NotificationDelivery"("providerMessageId");

CREATE SCHEMA IF NOT EXISTS private;

-- Returns the tenantId only when exactly one distinct tenant owns a WHATSAPP
-- delivery with this wamid; otherwise NULL (fail closed). No LIMIT 1. With no
-- GROUP BY the aggregate forms one group; a false HAVING (0 or >=2 tenants)
-- yields zero rows, which a scalar SQL function returns as NULL. STRICT returns
-- NULL for NULL input; the length guard rejects empty and oversized input.
CREATE OR REPLACE FUNCTION private.resolve_whatsapp_delivery_tenant_id(p_provider_message_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT min("tenantId")
  FROM public."NotificationDelivery"
  WHERE "channel" = 'WHATSAPP'
    AND "providerMessageId" = p_provider_message_id
    AND length(p_provider_message_id) BETWEEN 1 AND 256
  HAVING count(DISTINCT "tenantId") = 1
$$;

-- Explicit owner. Same role that owns private.resolve_whatsapp_tenant_id
-- (20261006190000_whatsapp_integration, owned implicitly by the migration
-- role, postgres). With FORCE RLS the owner must have BYPASSRLS or be
-- superuser, or the function sees zero rows; verified by the pre-rollout gate.
ALTER FUNCTION private.resolve_whatsapp_delivery_tenant_id(TEXT) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.resolve_whatsapp_delivery_tenant_id(TEXT) FROM PUBLIC;

-- Supabase-only roles; absent on CI's plain PostgreSQL 17, hence the guards.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION private.resolve_whatsapp_delivery_tenant_id(TEXT) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION private.resolve_whatsapp_delivery_tenant_id(TEXT) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION private.resolve_whatsapp_delivery_tenant_id(TEXT) FROM service_role';
  END IF;
END;
$$;

-- Runtime role only, matching 20261006190000_whatsapp_integration.
GRANT USAGE ON SCHEMA private TO postgres;
GRANT EXECUTE ON FUNCTION private.resolve_whatsapp_delivery_tenant_id(TEXT) TO postgres;
