# Tenant Resolution Foundation

## Purpose

Tenant resolution determines the application tenant context from a trusted route-derived slug. It does not authorize a user to act within that tenant.

## Security boundary

`Request route slug → Tenant resolver → TenantContext`

The resolver deliberately does not accept an arbitrary client-provided `tenantId` as its source of authority.

## Separation of concerns

- Authentication answers: who is the authenticated subject?
- Tenant resolution answers: which tenant context does this request target?
- Authorization will answer: may this identity operate in that tenant?

These concerns remain separate.

## Resolution outcomes

- `resolved`: a trusted resolver mapped the slug to an existing TenantId.
- `invalid_input`: the tenant context input is malformed or not a supported source.
- `not_found`: the slug is valid but no tenant mapping exists.

## Persistence boundary

This foundation does not query Prisma/PostgreSQL. The `resolveTenantId` callback is the future adapter boundary for persistence lookup.

A future Next.js route layer may extract a slug from the trusted route structure and delegate the lookup to a persistence adapter. RLS and authorization remain separate security layers.

## Out of scope

- Prisma/PostgreSQL lookup implementation
- RLS
- Supabase Auth
- middleware
- authorization
- booking
- UI
- production infrastructure
