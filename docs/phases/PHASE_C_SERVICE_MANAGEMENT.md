# Phase C — Service Management

## Status

Planned after Phase B.

## Goal

> A salon can define what customers can book.

## Approved Scope

- create/update service
- active/inactive
- duration
- buffer
- price only if confirmed by approved product requirements
- tenant ownership
- staff/service association if required

## Existing Context

The repository already contains service management application/persistence flows and tenant-scoped admin actions.

The current schema includes:
- service name
- duration in minutes
- buffer in minutes
- active state
- tenant ownership

Phase C should validate the existing capability against the approved product boundary and identify only the remaining gaps.

## Booking Dependency

Service duration and buffer are inputs to the future Booking Engine.

Example:

```
Service duration = 60 minutes
Buffer = 15 minutes
Required capacity = 75 minutes
```

Phase C must not independently implement availability logic.

## Security Invariants

- Services are tenant-owned.
- Cross-tenant reads/mutations remain impossible.
- Only authorized tenant administrators manage services.
- Client tenant IDs are never authoritative.
- Business rules remain server-side.

## Scope Boundaries

Do not silently add:
- complex pricing/discount engines
- packages
- memberships
- inventory consumption
- resource scheduling
- marketing/catalog features

Price is included only if explicitly confirmed by approved product requirements.

## Exit Criteria

Phase C is complete when:
- authorized tenant admins can create/update services;
- active/inactive state is safe;
- duration and buffer are validated;
- tenant ownership is enforced;
- required staff/service association behavior is defined and implemented only if approved;
- relevant tests and CI remain green.

## Next Phase

Phase D — Working Hours.
