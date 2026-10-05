# Prisma Tenant Context

Tenant-owned Prisma operations establish PostgreSQL RLS context inside a Prisma interactive transaction before the first tenant-owned query.

Flow: trusted TenantContext → prisma.$transaction → parameterized transaction-local set_config('app.tenant_id', ..., true) → tenant-scoped query → transaction completion.

The tenant ID is sourced only from trusted server-side TenantContext; client input is not authority. The transaction-local setting does not intentionally persist across pooled connections after the transaction ends.

PrismaMembershipReader runs its TenantMembership lookup inside this boundary and retains found, not_found, and PERSISTENCE_FAILURE outcomes. There is no unscoped or privileged fallback.

RLS remains defense-in-depth; application authorization remains mandatory. Normal tenant operations must not use PostgreSQL roles with BYPASSRLS or superuser privileges.

This change does not alter roles, authorization semantics, authentication, middleware, booking, schema, or production deployment.

CI also runs a PostgreSQL integration test that verifies matching tenant access, mismatched/absent tenant denial, and transaction-local context cleanup using a non-owner database role.
