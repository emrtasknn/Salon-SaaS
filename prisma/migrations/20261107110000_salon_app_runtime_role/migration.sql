-- PROPOSAL (RLS architecture change; owner approval required before merge).
--
-- Purpose
--   Today the app's DATABASE_URL connects as `postgres`, which on Supabase has
--   rolbypassrls = true, so FORCE RLS never applies at runtime and tenant
--   isolation rests only on explicit tenantId filters. This contradicts
--   docs/RLS_TENANT_ISOLATION.md ("a BYPASSRLS role must not be the normal
--   tenant-scoped runtime path"). This migration adds a dedicated runtime role
--   `salon_app` (NOSUPERUSER, NOBYPASSRLS) with the minimum DML privileges, so
--   the tenant policies keyed on current_setting('app.tenant_id', true) are
--   enforced for every app query once the app connects as this role.
--
-- What this migration does (additive only; nothing changes at runtime until
-- DATABASE_URL is switched):
--   * creates role salon_app NOLOGIN (idempotent; works on CI's plain
--     PostgreSQL 17 and on Supabase);
--   * public schema: USAGE, DML on all current tables except _prisma_migrations,
--     USAGE/SELECT on sequences, and default privileges for future objects
--     created by `postgres` (the migration role);
--   * private schema: USAGE + EXECUTE on the three SECURITY DEFINER functions.
--     The functions stay owned by `postgres`; salon_app gets no table access
--     in private;
--   * RateLimitBucket policy role list: postgres, salon_app (postgres kept for
--     backward compatibility until cutover). The function body runs as its
--     owner, so this is not needed for rate_limit_hit itself; salon_app still
--     has no privilege on the table.
--
-- No password is stored in git. LOGIN is a manual owner step per environment:
--   ALTER ROLE salon_app WITH LOGIN PASSWORD '<generated secret>';
-- Cutover (docs/STAGING_RUNBOOK.md "Runtime role cutover (salon_app)"):
--   staging first, then pilot: set LOGIN password, switch Vercel DATABASE_URL to
--   user `salon_app.<project-ref>` (Supavisor), redeploy, run the read-only
--   verification queries, smoke test. Migrations keep using `postgres`.
--
-- Rollback
--   Runtime: switch DATABASE_URL back to the postgres URL and redeploy (no data
--   change). Schema (only if the role must be removed entirely):
--     ALTER POLICY "RateLimitBucket_function_access" ON private."RateLimitBucket" TO postgres;
--     ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM salon_app;
--     ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM salon_app;
--     REVOKE ALL ON ALL TABLES IN SCHEMA public FROM salon_app;
--     REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM salon_app;
--     REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM salon_app;
--     REVOKE USAGE ON SCHEMA public, private FROM salon_app;
--     DROP ROLE salon_app;
--
-- Independent of any sibling 20261107100000 migration: it only references
-- objects created by migrations up to 20261106100000, and the
-- ALL TABLES grant picks up whatever exists when it runs (default privileges
-- cover later tables).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'salon_app') THEN
    CREATE ROLE salon_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  -- Fail closed if a pre-existing role would defeat the purpose. (No ALTER ROLE
  -- here: on PostgreSQL < 16 only a superuser may even mention BYPASSRLS.)
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'salon_app' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
  ) THEN
    RAISE EXCEPTION 'salon_app exists with SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB; fix the role manually';
  END IF;
END;
$$;

-- public schema: DML only (no TRUNCATE, REFERENCES, TRIGGER, DDL).
GRANT USAGE ON SCHEMA public TO salon_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salon_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO salon_app;

DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public._prisma_migrations FROM salon_app';
  END IF;
END;
$$;

-- Future tables/sequences created by the migration role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salon_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO salon_app;

-- private schema: the narrow SECURITY DEFINER entry points only (owner stays postgres).
GRANT USAGE ON SCHEMA private TO salon_app;
GRANT EXECUTE ON FUNCTION private.resolve_whatsapp_tenant_id(TEXT) TO salon_app;
GRANT EXECUTE ON FUNCTION private.resolve_whatsapp_delivery_tenant_id(TEXT) TO salon_app;
GRANT EXECUTE ON FUNCTION private.rate_limit_hit(TEXT, TEXT, INTEGER) TO salon_app;

ALTER POLICY "RateLimitBucket_function_access" ON private."RateLimitBucket"
  TO postgres, salon_app;
