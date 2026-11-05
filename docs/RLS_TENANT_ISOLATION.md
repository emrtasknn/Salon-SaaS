# PostgreSQL RLS Tenant Isolation

## Purpose

PostgreSQL Row Level Security (RLS) is a defense-in-depth boundary for tenant-owned data. It does not replace application authentication or authorization.

## Trusted context

Normal tenant-scoped database work follows:

`Server Auth → TenantContext → transaction-local app.tenant_id → PostgreSQL RLS`

The application must derive `app.tenant_id` only from the trusted `TenantContext`. Client-provided tenant IDs are not an authority.

## Transaction-local requirement

The tenant setting is established with:

`set_config('app.tenant_id', $1, true)`

The third argument is `true`, making the setting local to the current transaction.

Do not replace this with a session-level `SET` or `set_config(..., false)`. A pooled connection must never retain one tenant's context for a later request.

## Protected tables

RLS is enabled and forced on:

- `Profile`
- `Staff`
- `Service`
- `Appointment`
- `TenantMembership`
- `AppointmentAccessToken` (WP-06, migration `20261104110000_appointment_access_token`: ENABLE + FORCE, `appointment_access_token_tenant_isolation_select` / `_insert` / `_update` / `_delete`). Stores only the SHA-256 hash of the customer status-link token; lookups always filter by the slug-resolved `tenantId`.

The `Tenant` root table is intentionally not covered by this migration because trusted tenant resolution may need to discover a tenant before a tenant context exists. Tenant-owned data remains protected by the listed policies.

## Policy behavior

Each protected table requires its `tenantId` to equal the current transaction-local `app.tenant_id`.

Therefore:

- missing tenant context → no tenant rows match;
- cross-tenant SELECT → hidden;
- cross-tenant INSERT → rejected by `WITH CHECK`;
- cross-tenant UPDATE → cannot target or write another tenant;
- cross-tenant DELETE → cannot target another tenant.

## SUPER_ADMIN

RLS does not create a global SUPER_ADMIN bypass. The role continues to operate inside an explicit trusted TenantContext. Cross-tenant operations require a separate, explicitly authorized workflow and are not part of normal tenant-scoped access.

## PostgreSQL role requirement

RLS must be effective for the runtime database role. The migration uses `FORCE ROW LEVEL SECURITY` so table ownership alone does not silently bypass the policies. A role with PostgreSQL `BYPASSRLS` (including superuser semantics) can still bypass RLS; such a privileged role must not be used as the normal tenant-scoped runtime path.

Status (verified read-only 2026-11-05): pilot and staging still connect as `postgres`, which has `rolbypassrls = true`, so RLS is **not** enforced at runtime yet and isolation relies on explicit `tenantId` filters. Proposal: migration `20261107110000_salon_app_runtime_role` adds `salon_app` (NOSUPERUSER, NOBYPASSRLS, DML on `public` except `_prisma_migrations`, EXECUTE on the `private` SECURITY DEFINER functions, which stay owned by `postgres`). The app switches by changing `DATABASE_URL` only (`docs/STAGING_RUNBOOK.md` §4.7); migrations keep using `postgres`. CI runs `salon-app-runtime-role.integration.test.ts` connected as `salon_app`. Under this role every query on an RLS table must run inside `withPrismaTenantContext`; only `Tenant` and the `private` functions are reachable without a tenant context.

## Non-tenant server-only tables (`private` schema)

Some server-only data has no tenant column and is used before or outside a tenant context. These objects live in the `private` schema, are not modelled in Prisma, and are reachable only through a narrow `SECURITY DEFINER` function with `SET search_path = ''`:

- `private.resolve_whatsapp_tenant_id` (webhook tenant routing, migration `20261006190000_whatsapp_integration`).
- `private."RateLimitBucket"` via `private.rate_limit_hit` (WP-5, migration `20261104100000_rate_limit`, `docs/tasks/WP-05.md`). The table is ENABLE + FORCE RLS with one policy (`TO postgres`, plus `salon_app` from migration `20261107110000`) that admits rows only while the transaction-local flag `app.rate_limit_access = 'on'` is set; only the function sets and clears it. Rows hold HMAC keys and counters only — no tenant data, no raw IP/phone/email. `PUBLIC`, `anon` and `authenticated` have no grants.

Owner-approved exception (2026-11-04): this pattern is for non-tenant data only and must never be used to reach tenant-owned rows.

## Migration validation

The migration should be validated against disposable PostgreSQL before merge and against the actual Supabase role model before production deployment.

## Scope

This change does not implement booking, UI, authentication, authorization-policy changes, production deployment, or production database migration execution.
