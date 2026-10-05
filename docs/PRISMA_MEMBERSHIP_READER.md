# Prisma MembershipReader Adapter

The Prisma MembershipReader adapter is the infrastructure implementation of the provider-neutral membership persistence seam.

## Boundary

The adapter receives:
- a trusted TenantContext
- an authenticated identity

It queries TenantMembership using the composite unique key tenantId + subjectId.

The adapter returns the existing MembershipLookupResult:
- found
- not_found
- error: PERSISTENCE_FAILURE

It does not authorize the caller. The returned AuthorizationMembership must still be evaluated by the existing authorize() boundary.

## Security properties

- Tenant scope is taken only from TenantContext.
- Subject scope is taken only from the authenticated identity.
- The lookup never falls back to profile-only or global subject lookup.
- Persistence failures fail closed.
- No new roles or authorization semantics are introduced.

The adapter depends on the minimal TenantMembershipDelegate shape instead of importing Prisma-specific types into domain contracts. A generated Prisma client's tenantMembership delegate can be injected at the application composition boundary.

## Out of scope

This adapter does not implement Supabase Auth, sessions, middleware, RLS, routes/server actions, booking, UI, or production database deployment.
