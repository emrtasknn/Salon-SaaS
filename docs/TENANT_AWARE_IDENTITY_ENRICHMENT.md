# Tenant-Aware Authenticated Identity Enrichment

This document records the implementation boundary introduced by ADR-033 and Issue #35.

## Trusted sequence

1. Supabase Auth establishes the authenticated subject.
2. Trusted tenant resolution establishes TenantContext.
3. TenantMembership(tenantId, subjectId) is queried.
4. The persisted profileId is used to enrich the application identity.
5. Existing authorization evaluates the enriched identity and membership.

## Authority boundaries

| Concern | Authoritative source |
| --- | --- |
| Authenticated subject | Server-side Supabase Auth |
| Tenant | Trusted TenantContext |
| Profile + role within tenant | TenantMembership |
| Access decision | authorize() / evaluateAuthorization() |

Authentication does not resolve profile, tenant, or role.

## Failure behavior

- Authentication failure → unauthenticated.
- Missing membership → unauthenticated application identity for the protected operation.
- Persistence failure → fail closed.
- Tenant mismatch → fail closed.
- Subject mismatch → fail closed.

## Security invariants

- No global subjectId → Profile lookup.
- No first-match profile behavior.
- No tenant inferred from arbitrary client input.
- No profile provisioning or membership synchronization.
- SUPER_ADMIN does not bypass tenant membership.
- No schema changes are required by Issue #35.

## Scope boundary

Issue #35 does not introduce RLS, middleware, booking, UI, production configuration, or authorization policy changes.