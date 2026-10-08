# Phase A — Tenant / Salon Management

## Status

Next MVP product-domain phase.

## Goal

> A tenant can exist as a usable salon account.

## Approved Scope

- tenant creation/use case
- tenant slug
- salon basic information
- timezone
- basic settings
- tenant-safe persistence
- server-side authorization

## Existing Repository Context

The current repository already contains tenant provisioning domain/application and persistence building blocks.

Notable existing components include:
- `src/application/tenant-provisioning.ts`
- `src/application/tenant-admin-auth-binding.ts`
- `src/persistence/prisma-tenant-provisioning.ts`
- `Tenant`, `Profile`, and `TenantMembership` persistence models

The repository also contains authenticated tenant request and server-side authorization boundaries.

These existing components must be inspected and reused where appropriate rather than replaced or duplicated.

## Important Authorization Boundary

The current tenant provisioning application actor model permits:
- `SUPER_ADMIN`
- `TENANT_ONBOARDING`

The first provisioned membership is `TENANT_ADMIN`.

This means Phase A must preserve the distinction between:
1. platform/onboarding tenant provisioning, and
2. normal tenant-admin operations inside an already existing tenant.

Tenant admins must not implicitly gain authority to create arbitrary other tenants.

## Security Invariants

- Client-supplied tenant IDs are never authoritative.
- Tenant context comes from the trusted authenticated request boundary.
- Tenant-owned persistence remains tenant-safe.
- Server-side authorization is mandatory.
- RLS remains defense-in-depth.
- Normal tenant operations must not use privileged/BYPASSRLS access paths.
- Missing tenant context and persistence failures fail closed.

## Scope Boundaries

Do not silently add:
- subscription/billing
- multi-location
- advanced tenant configuration
- holiday/exception scheduling
- unrelated onboarding automation
- new external identity providers

Any requirement that changes the tenant model or authentication binding requires architecture review.

## Exit Criteria

Phase A is complete when:
- the approved tenant provisioning/use case is usable through a supported application boundary;
- tenant slug, name, timezone, and approved basic settings are persisted safely;
- the first tenant administrator is bound through the approved authentication/membership model;
- unauthorized tenant provisioning is rejected;
- duplicate/invalid input fails explicitly;
- persistence and auth-binding failure paths fail safely;
- tenant isolation and authorization tests remain green.

## Next Phase

Phase B — Staff Management.
