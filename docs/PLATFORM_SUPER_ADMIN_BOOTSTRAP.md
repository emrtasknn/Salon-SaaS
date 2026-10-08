# Platform SUPER_ADMIN Bootstrap

## Purpose

The platform tenant-provisioning boundary is intentionally independent from tenant membership.

A SUPER_ADMIN is recognized only when the authenticated Supabase user has the server-managed app_metadata.platform_role value: SUPER_ADMIN.

This value is not accepted from client form input and is never inferred from a tenant membership.

## Bootstrap procedure

Create or select the platform administrator in Supabase Auth, then set the user's app metadata to:

{
  "platform_role": "SUPER_ADMIN"
}

Do not place this value in user metadata.

The existing login flow uses this trusted value only for navigation to /platform/tenants. The platform page and tenant-creation server action independently re-check the same trusted server-side value before allowing the operation.

## Tenant creation flow

1. SUPER_ADMIN signs in through /login.
2. The login UI routes the platform administrator to /platform/tenants.
3. The server-side platform boundary verifies platform_role=SUPER_ADMIN.
4. The SUPER_ADMIN submits salon name, slug, timezone, and first tenant-admin credentials.
5. The existing tenant provisioning use case creates the Auth account, binds its tenant, and persists Tenant + Profile + TenantMembership.
6. The first membership is always TENANT_ADMIN.
7. The tenant admin receives a normal email/password Auth account.
8. The tenant admin signs in through /login and is routed to /admin.
9. Tenant admin authorization is still resolved from trusted tenant context + TenantMembership; the client never supplies authoritative tenant identity.

## Security constraints

- platform_role is server-managed Supabase app_metadata.
- Tenant admins do not receive platform_role=SUPER_ADMIN.
- Tenant admins cannot call the tenant-provisioning action successfully.
- No RLS policy is weakened or bypassed.
- No normal tenant operation receives a service-role database path.
- Client-supplied tenant IDs are not trusted.
- Failed Auth binding or persistence continues to use the existing compensation/fail-closed flow.

## Operational note

This is a bootstrap capability, not a public self-registration flow. Do not add a public route for assigning SUPER_ADMIN.
