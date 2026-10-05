# ADR-033 — Tenant-Aware Authenticated Profile Resolution

## Status

Accepted architecture; implementation deferred to a separate approved issue.

## Context

The current authentication chain obtains a server-derived Supabase Auth subject ID.

The current persistence model stores the subject-to-profile relationship on `TenantMembership`:

- `tenantId`
- `subjectId`
- `profileId`
- `role`

The `Profile` model itself does not contain `subjectId`.

Therefore a global lookup of `subjectId → Profile` is ambiguous. A profile must be resolved only after a trusted tenant boundary exists.

Issue #32 was blocked because its original subject-only profile lookup shape could not safely map an authenticated subject to a profile without tenant context.

## Decision

Use tenant-aware identity enrichment.

The authoritative sequence is:

`Server Auth`
→ authenticated `subjectId`
→ trusted `TenantContext`
→ tenant-scoped `TenantMembership(subjectId, tenantId)`
→ `profileId`
→ enriched application identity
→ existing authorization

Authentication establishes who the request is authenticated as. Tenant resolution establishes which tenant the request is operating in. Membership persistence establishes the profile and role for that subject within that tenant. Authorization then makes the access decision.

## Identity boundaries

### 1. Authentication identity

The server-side Supabase Auth boundary establishes only the authenticated subject.

It must not infer:

- tenant ID
- role
- profile ID

### 2. Tenant context

The existing tenant-resolution boundary establishes trusted `TenantContext`.

Client-provided tenant IDs are not trusted.

### 3. Tenant membership mapping

After both authenticated subject and trusted tenant context exist, a tenant-scoped membership lookup resolves:

`tenantId + subjectId → profileId + role`

The existing `TenantMembership` model remains the authoritative persisted relationship.

### 4. Application identity enrichment

The authenticated subject can be enriched with the resolved profile only after the tenant-scoped lookup succeeds.

A future implementation may introduce an intermediate authenticated identity representation that contains the subject without requiring `profileId`, followed by a tenant-aware enrichment step.

This ADR does not prescribe the exact TypeScript contract shape; that belongs to the implementation issue.

### 5. Authorization

Authorization remains centralized in the existing:

- `evaluateAuthorization()`
- `authorize()`

No new authorization policy is introduced by this decision.

## Failure behavior

The identity-resolution flow must fail closed.

### Unauthenticated

No authenticated subject exists.

Result: unauthenticated.

### Tenant unresolved

No trusted TenantContext exists.

Result: protected operation cannot proceed.

### Membership not found

No `TenantMembership` exists for the authenticated subject in the trusted tenant.

Result: no authenticated application identity for the protected operation.

### Persistence failure

Membership lookup fails unexpectedly.

Result: protected operation cannot proceed.

### Tenant mismatch

A membership from another tenant must never be accepted.

Result: deny/fail closed.

### Identity mismatch

A membership for a different authenticated subject must never be accepted.

Result: deny/fail closed.

## Security invariants

1. Supabase Auth is authoritative only for the authenticated subject.
2. TenantContext is the only tenant authority.
3. TenantMembership is the authoritative persisted subject-to-profile relationship within a tenant.
4. No global subject-only Profile lookup is permitted.
5. No “first matching profile” behavior is permitted.
6. No tenant may be inferred from arbitrary client input.
7. Missing membership fails closed.
8. Persistence failures fail closed.
9. Profile creation is not part of identity resolution.
10. Membership synchronization is not part of identity resolution.
11. Authorization remains centralized.
12. SUPER_ADMIN does not receive an implicit cross-tenant bypass.

## Impact on existing foundations

### #24 — Server Authentication Request Boundary

The boundary remains responsible for obtaining server-derived authentication state.

It should not independently resolve tenant membership.

### #26 — Server Authorization Enforcement Boundary

The enforcement boundary remains responsible for consuming trusted identity/tenant inputs and delegating authorization.

It should not invent a second profile-resolution policy.

### #28 — Supabase Auth Adapter

The adapter remains responsible for translating Supabase Auth state into the provider-neutral authentication boundary.

Its current injected profile resolver must be reconsidered during implementation because profile resolution now depends on trusted TenantContext.

### #32 — Profile Mapping Persistence Seam

The original subject-only lookup design is superseded by this ADR.

Issue #32 remains blocked until an implementation issue adopts the tenant-aware design.

## Implementation migration path

The next implementation issue should:

1. Introduce the smallest intermediate authenticated identity contract needed to represent a trusted subject before profile enrichment.
2. Preserve the existing Supabase Auth provider boundary.
3. Resolve TenantContext independently.
4. Perform a tenant-scoped membership lookup using trusted TenantContext + authenticated subject.
5. Enrich the application identity with the persisted profile only after successful mapping.
6. Feed the resulting trusted inputs into the existing authorization composition.
7. Preserve fail-closed behavior.
8. Add focused cross-tenant and identity-mismatch tests.
9. Avoid schema changes unless a separate architecture review proves they are required.

## Non-goals

This ADR does not authorize:

- profile provisioning
- membership synchronization
- PostgreSQL RLS
- Next.js middleware
- booking implementation
- UI/login screens
- production configuration
- production deployment
- new roles
- authorization policy changes
- unrelated schema changes

## Consequence

The authentication chain becomes explicitly ordered around trusted boundaries instead of trying to resolve a profile globally.

This adds one architectural enrichment step, but it prevents ambiguous identity mapping and preserves tenant isolation as a first-class security invariant.
