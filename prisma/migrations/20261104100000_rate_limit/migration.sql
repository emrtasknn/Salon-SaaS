-- WP-5 rate limiting: fixed-window counters (DRAFT, pending owner approval).
--
-- Purpose
--   Durable, cross-instance rate-limit counters for server-side abuse
--   protection (public booking, WP-6 status link).
--
-- Access path (server-only)
--   The application calls private.rate_limit_hit(...) from server code via the
--   runtime database role. No client, anon or authenticated role may read or
--   write the table or execute the function. ENABLE + FORCE ROW LEVEL SECURITY
--   apply as on tenant tables. The single policy only admits the runtime role
--   while the transaction-local flag app.rate_limit_access = 'on' is set, and
--   only rate_limit_hit sets (and clears) it. Direct row access is therefore
--   denied by default, even for the table owner, unless the role has BYPASSRLS.
--
-- Data minimisation
--   "key" is a hex HMAC-SHA256 computed server-side (tenant, bucket and
--   subject are folded into it before hashing). No raw IP, phone or email is
--   stored. There is no tenant column, so no tenant-scoped RLS policy applies.
--
-- Why no Prisma model
--   Same precedent as private.resolve_whatsapp_tenant_id
--   (20261006190000_whatsapp_integration): objects in the "private" schema are
--   not modelled in prisma/schema.prisma (datasource has no "schemas" /
--   multiSchema), so Prisma's diff does not see them. Access is via raw SQL
--   function call only.
--
-- Deployment
--   Apply ONLY through CI (isolated PostgreSQL) and the approved deploy
--   workflow. Never apply manually against Pilot/production.
--
-- Rollback
--   DROP FUNCTION IF EXISTS private.rate_limit_hit(TEXT, TEXT, INTEGER);
--   DROP TABLE IF EXISTS private."RateLimitBucket";
--   (Data is ephemeral counters only; dropping loses no business data.)

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private."RateLimitBucket" (
  "key" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ NOT NULL,
  "count" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "RateLimitBucket_key_format_check" CHECK ("key" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RateLimitBucket_bucket_format_check" CHECK ("bucket" ~ '^[a-z][a-z0-9_.]{0,63}$'),
  CONSTRAINT "RateLimitBucket_count_check" CHECK ("count" >= 1)
);

CREATE INDEX "RateLimitBucket_window_start_idx"
  ON private."RateLimitBucket"("window_start");

ALTER TABLE private."RateLimitBucket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE private."RateLimitBucket" FORCE ROW LEVEL SECURITY;

-- Mirrors the app.tenant_id pattern: rows are reachable only while the
-- function has set the transaction-local flag. Without this policy, FORCE RLS
-- would deny the SECURITY DEFINER function itself whenever its owner lacks
-- BYPASSRLS (expected on Supabase, where tenant RLS relies on that).
CREATE POLICY "RateLimitBucket_function_access" ON private."RateLimitBucket"
  FOR ALL
  TO postgres
  USING (current_setting('app.rate_limit_access', true) = 'on')
  WITH CHECK (current_setting('app.rate_limit_access', true) = 'on');

REVOKE ALL ON TABLE private."RateLimitBucket" FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.rate_limit_hit(
  p_key TEXT,
  p_bucket TEXT,
  p_window_seconds INTEGER
)
RETURNS TABLE(hit_count INTEGER, window_start TIMESTAMPTZ)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
  v_result_window TIMESTAMPTZ;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rate_limit_hit: invalid key' USING ERRCODE = '22023';
  END IF;
  IF p_bucket IS NULL OR p_bucket !~ '^[a-z][a-z0-9_.]{0,63}$' THEN
    RAISE EXCEPTION 'rate_limit_hit: invalid bucket' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'rate_limit_hit: invalid window' USING ERRCODE = '22023';
  END IF;

  v_window_start := date_bin(
    make_interval(secs => p_window_seconds),
    now(),
    TIMESTAMPTZ '2000-01-01 00:00:00+00'
  );

  -- Open the RLS policy for this call only (transaction-local).
  PERFORM pg_catalog.set_config('app.rate_limit_access', 'on', true);

  -- Single atomic upsert. A row from a newer window (written by a transaction
  -- with a later now()) is never moved backwards.
  INSERT INTO private."RateLimitBucket" AS b
    ("key", "bucket", "window_start", "count", "updated_at")
  VALUES (p_key, p_bucket, v_window_start, 1, now())
  ON CONFLICT ("key") DO UPDATE SET
    "count" = CASE
      WHEN b."window_start" >= EXCLUDED."window_start" THEN b."count" + 1
      ELSE 1
    END,
    "window_start" = GREATEST(b."window_start", EXCLUDED."window_start"),
    "bucket" = EXCLUDED."bucket",
    "updated_at" = now()
  RETURNING b."count", b."window_start" INTO v_count, v_result_window;

  -- Opportunistic, bounded cleanup (~1% of calls). The max window is 1 day,
  -- so rows older than 1 day can never be the current window.
  IF random() < 0.01 THEN
    DELETE FROM private."RateLimitBucket" AS d
    WHERE d."key" IN (
      SELECT o."key"
      FROM private."RateLimitBucket" AS o
      WHERE o."window_start" < now() - INTERVAL '1 day'
      LIMIT 500
      FOR UPDATE SKIP LOCKED
    );
  END IF;

  -- Close it again so a surrounding transaction does not keep direct access.
  -- (On an exception the flag is discarded with the aborted transaction.)
  PERFORM pg_catalog.set_config('app.rate_limit_access', '', true);

  hit_count := v_count;
  window_start := v_result_window;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION private.rate_limit_hit(TEXT, TEXT, INTEGER) FROM PUBLIC;

-- Supabase-only roles; absent on CI's plain PostgreSQL 17, hence the guards.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE private."RateLimitBucket" FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION private.rate_limit_hit(TEXT, TEXT, INTEGER) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE private."RateLimitBucket" FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION private.rate_limit_hit(TEXT, TEXT, INTEGER) FROM authenticated';
  END IF;
END;
$$;

-- Runtime role, matching the precedent in 20261006190000_whatsapp_integration.
GRANT USAGE ON SCHEMA private TO postgres;
GRANT EXECUTE ON FUNCTION private.rate_limit_hit(TEXT, TEXT, INTEGER) TO postgres;
