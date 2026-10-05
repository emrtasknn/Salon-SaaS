# Persistence Foundation

Issue #6 establishes the first PostgreSQL/Prisma persistence boundary after the framework-agnostic TenantId/TenantContext contract from Issue #4.

## Technology boundary

- PostgreSQL is the persistence target.
- Prisma ORM is pinned to stable 7.10.0 for this foundation.
- Prisma Client uses the PostgreSQL driver adapter.
- DATABASE_URL is environment-provided; credentials are never committed.
- Generated Prisma Client is written to src/generated/prisma and is not a hand-authored domain contract.

## Core records

- Tenant — tenant root and globally unique slug.
- Profile — tenant-owned user-facing identity record. It is not an authentication/session record.
- Staff — tenant-owned operational staff record linked to one Profile.
- Service — tenant-owned service definition with duration/buffer fields persisted as data only.
- Appointment — tenant-owned scheduled record referencing staff, service, and customer Profile, with start/end timestamps.

All timestamps are stored as PostgreSQL timestamp-with-time-zone values through Prisma DateTime and are expected to represent UTC instants.

## Tenant ownership

Every business record except the Tenant root carries an explicit tenantId foreign key to Tenant. The database relation establishes ownership structurally.

This does not claim complete cross-tenant isolation. Trusted tenant resolution, application authorization, and PostgreSQL RLS remain later security work. Client-provided tenant identifiers are not trusted merely because they satisfy the domain TenantId validation.

The persistence layer does not replace the domain TenantId branded type. A later repository/application boundary must translate between persistence identifiers and the domain contract explicitly.

## Constraints and indexes

- Tenant slug is globally unique.
- Service name is unique within a tenant.
- Profile email is unique within a tenant when present; PostgreSQL nullable uniqueness permits multiple nulls.
- Relation fields have foreign keys with restrictive deletion semantics to avoid silent tenant-owned data loss.
- Appointment lookup indexes begin with tenantId and cover the first persistence queries expected by the booking/calendar layers.
- No database constraint here attempts to solve appointment overlap detection.

## Explicitly deferred

This issue does not implement authentication, trusted tenant resolution, authorization middleware, PostgreSQL RLS, booking slot calculation, availability checks, appointment conflict detection, appointment lifecycle/state transitions, server actions, route handlers, UI, storefront/dashboard, production database changes, or deployment.

Those concerns require separate approved changes.
