# Authentication Foundation

## Purpose

This foundation defines the application boundary between an external authentication subject and the application's internal Profile identity.

## Boundary

`Auth Provider → AuthSubjectId → Profile ID`

The contract is provider-neutral. Provider SDK types, sessions, cookies, middleware, and credentials are deliberately outside this layer.

## Identity states

- `unauthenticated`: no authenticated application identity is available.
- `authenticated`: contains an opaque provider subject identifier and the mapped internal Profile ID.

The contract does not contain `tenantId`. Tenant resolution is a separate concern and must not be inferred here.

## Mapping

`AuthProfileMapping` expresses the future adapter result that maps an external auth subject to an internal Profile ID.

The adapter boundary is intentionally abstract. A future Supabase Auth adapter may translate provider-specific identity data into this contract without leaking Supabase types into the domain layer.

## Out of scope

- Supabase SDK integration
- sessions and cookies
- middleware
- authorization policy
- tenant resolution
- PostgreSQL RLS
- Prisma schema/migrations
- booking logic
- UI
- production credentials or deployment

## Validation

The contract is covered by focused unit tests for valid/invalid identifiers, explicit identity states, mapping separation, and tenant non-inclusion.
