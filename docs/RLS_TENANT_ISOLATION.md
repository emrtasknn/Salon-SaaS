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

## Migration validation

The migration should be validated against disposable PostgreSQL before merge and against the actual Supabase role model before production deployment.

## Scope

This change does not implement booking, UI, authentication, authorization-policy changes, production deployment, or production database migration execution.
