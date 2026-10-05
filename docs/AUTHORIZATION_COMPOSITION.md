# Authorization Composition Boundary

## Purpose

The application authorization composition boundary connects the completed provider-neutral contracts without moving provider-specific concerns into domain authorization.

Dependency direction:

Application composition -> TenantContext, ApplicationIdentity, MembershipReader, authorize(), AuthorizationResult.

Infrastructure edge -> PrismaMembershipReader -> TenantMembership.

## Rules

1. TenantContext is trusted input produced by the tenant-resolution boundary. This layer does not accept or reinterpret arbitrary client tenant IDs.
2. AuthenticatedIdentity supplies the authenticated subject and profile identity.
3. MembershipReader performs persistence lookup; it does not make authorization decisions.
4. authorize() remains the sole function deciding whether a resolved membership satisfies tenant, identity, and role requirements.
5. Unauthenticated identities do not trigger persistence lookup.
6. Missing membership and persistence failure both fail closed by passing membership: null to authorize().
7. The result records the lookup outcome separately so persistence failure is not mistaken for a successful lookup.
8. Prisma-specific construction remains outside this provider-neutral application boundary.

## Deliberate non-goals

This boundary does not implement Supabase Auth, sessions, Next.js middleware/routes/server actions, RLS, production database wiring, booking, UI, or new authorization semantics.
