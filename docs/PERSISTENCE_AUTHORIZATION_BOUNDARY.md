# Persistence ↔ Authorization Boundary

## Purpose

This boundary defines how authorization obtains tenant membership from persistence without coupling authorization policy to Prisma, PostgreSQL, Supabase, or request handling.

## Contract

`MembershipLookupInput` contains:

- trusted `TenantContext`
- authenticated `AuthenticatedIdentity`

The reader returns one of:

- `found` — an existing `AuthorizationMembership`
- `not_found` — no membership exists for the trusted tenant and authenticated identity
- `error` — persistence/infrastructure failure

The existing `AuthorizationMembership` shape from `src/domain/authorization.ts` is reused. No second membership model is introduced.

## Security boundary

The trusted `TenantContext` is the tenant authority.

The persistence contract does not accept a client-provided `tenantId` or `clientTenantId`. A caller cannot replace the trusted tenant context with arbitrary request data through this interface.

The authenticated identity is also explicit. An unauthenticated identity cannot be supplied to the membership reader because the input requires `AuthenticatedIdentity`.

## Failure semantics

`not_found` and `error` are intentionally distinct.

A persistence failure must not be interpreted as a missing membership, and neither outcome is an authorization allow. The future application orchestration layer must fail closed when a membership cannot be safely established.

## Future adapter seam

A future implementation may satisfy `MembershipReader` using Prisma/PostgreSQL/Supabase persistence.

That implementation is deliberately outside this foundation. It may add concrete query behavior only after the relevant persistence/schema work is explicitly approved.

## Out of scope

- Prisma queries
- schema or migrations
- PostgreSQL RLS
- Supabase SDK
- Next.js middleware/routes/server actions
- booking engine
- UI
- production infrastructure
- new dependencies
- changes to Auth Identity, Tenant Resolution, or Authorization policy
