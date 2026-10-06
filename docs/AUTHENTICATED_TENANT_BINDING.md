# Authenticated Tenant Binding

## Decision

For authenticated owner/staff application requests, the tenant is not selected by the browser.

The trusted request boundary receives:

Supabase Auth subject
+
server-managed app_metadata.tenant_id
        ↓
AuthenticatedTenantRequest
        ↓
TenantContext
        ↓
TenantMembership
        ↓
Authorization
        ↓
tenant-aware use case
        ↓
Prisma + PostgreSQL RLS

The app_metadata.tenant_id value is used only as the trusted tenant binding established by the server-side authentication/provisioning boundary. It is not read from client form data, URL parameters, or user_metadata.

## Product rule

- One owner/staff account belongs to exactly one tenant.
- A tenant can have multiple TENANT_ADMIN and STAFF memberships.
- A customer can create appointments for multiple tenants.
- Owner/staff requests therefore do not need a tenant switcher.
- Public/customer booking resolves tenant context from the public tenant slug and does not use authenticated owner/staff tenant binding.

## Security rules

1. Client-provided tenantId is never authoritative.
2. user_metadata is never authoritative for tenant selection.
3. Missing or invalid tenant binding fails closed.
4. The tenant binding does not replace TenantMembership authorization.
5. RLS remains the persistence defense in depth.
6. No global subject-to-profile lookup is introduced.
7. Service-role credentials remain server-only.

## Provisioning requirement

Every authenticated owner/staff account must receive the server-managed app_metadata.tenant_id binding when its tenant membership is provisioned.

This binding must be updated atomically with, or safely compensated alongside, membership changes. A future implementation must not silently allow a database membership to exist without a matching trusted auth binding.

## Runtime requirement

The Next.js server auth client must use the Supabase SSR cookie mechanism. The application request boundary must obtain the authenticated user from the server-side Supabase client and then pass the resulting trusted subject + tenant binding to authorization.

The request boundary must remain request-scoped.

## Non-goals

- no tenant switcher
- no client-side tenant authority
- no second RBAC system
- no RLS bypass
- no changes to appointment state transitions
- no customer global profile model
