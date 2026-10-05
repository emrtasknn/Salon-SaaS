# Authorization Foundation

## Purpose

The authorization boundary decides whether an authenticated application identity may perform a tenant-scoped operation in a trusted tenant context.

It does not authenticate the subject, resolve the tenant, query persistence, or enforce database RLS.

## Security boundary

`ApplicationIdentity + trusted TenantContext + membership → AuthorizationResult`

The tenant context is the authority for the target tenant. An arbitrary client-provided `tenantId` is not an authorization source.

## Roles

The foundation uses the existing governance roles:

- `SUPER_ADMIN`
- `TENANT_ADMIN`
- `STAFF`
- `CUSTOMER`

Role requirements are explicit and evaluated server-side. The foundation uses the following minimum role ordering:

`CUSTOMER < STAFF < TENANT_ADMIN < SUPER_ADMIN`

A `SUPER_ADMIN` is allowed to satisfy a lower tenant-scoped role requirement only when the authorization membership explicitly identifies that role for the authenticated identity in the trusted tenant context. No persistence semantics are implied.

## Fail-closed behavior

Authorization denies when:

- the request is malformed;
- the identity is unauthenticated;
- membership is absent;
- membership tenant differs from the trusted tenant context;
- membership subject/profile differs from the authenticated identity;
- the membership role is below the required role.

## Separation of concerns

- Authentication answers: who is the subject?
- Tenant resolution answers: which trusted tenant does the request target?
- Authorization answers: may this identity operate in that tenant?
- Persistence answers: how is membership retrieved?
- RLS answers: what database-level access remains possible if an application-layer control fails?

## Future persistence seam

A future adapter may load an `AuthorizationMembership` from Prisma/PostgreSQL/Supabase. That adapter is deliberately outside this foundation.

## Out of scope

- Supabase Auth/session implementation
- Prisma membership queries
- database writes
- RLS policies
- Next.js middleware
- route handlers/server actions
- booking engine
- UI
- production infrastructure
- new dependencies
