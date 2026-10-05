# Tenant Membership Persistence

## Purpose

`TenantMembership` is the durable persistence representation of the existing authorization membership contract.

It stores only the fields already required by the authorization boundary:
- `tenantId`
- `subjectId`
- `profileId`
- `role`

`subjectId` remains provider-neutral and represents the authenticated application's subject identity.

## Integrity

- `tenantId + subjectId` is unique, preventing ambiguous duplicate membership for one authenticated subject inside a tenant.
- `tenantId + profileId` is enforced through a composite foreign key to `Profile`, preventing a membership from pointing at a profile owned by another tenant.
- `role` is a PostgreSQL enum containing exactly `SUPER_ADMIN`, `TENANT_ADMIN`, `STAFF`, and `CUSTOMER`.
- Tenant deletion and profile deletion are restricted by foreign-key behavior.

## Boundary

This model does not authenticate a subject and does not authorize an operation. The application flow remains:
1. authenticate the subject;
2. resolve trusted tenant context;
3. retrieve tenant membership;
4. apply authorization policy;
5. rely on database integrity/RLS as defense in depth.

The Prisma membership adapter is intentionally a later step. This migration only establishes durable data integrity.

## Validation

The migration is intended to be applied to disposable PostgreSQL during validation. Production database migration is out of scope for this issue.
