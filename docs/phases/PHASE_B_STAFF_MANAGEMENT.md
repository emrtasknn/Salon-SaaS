# Phase B — Staff Management

## Status

Planned after Phase A.

## Goal

> A salon can define who provides services.

## Approved Scope

- create/update staff
- activate/deactivate
- tenant relationship
- role handling through existing authorization
- schedule boundary

## Existing Context

The repository already contains staff management application/persistence flows and admin actions for creating staff and changing staff status.

Phase B should consolidate and validate the existing implementation against the phase boundary rather than re-inventing an already implemented capability.

## Security Invariants

- Staff records are tenant-owned.
- Staff membership and profile relationships remain tenant-consistent.
- Only an authorized tenant administrator may manage staff.
- Inactive staff must not be treated as active appointment providers.
- Client-provided tenant identifiers never grant authority.
- RLS and server-side authorization remain mandatory.

## Scope Boundaries

Do not silently add:
- payroll
- advanced scheduling
- commissions
- resource/chair assignment
- employee HR functionality
- multi-location staff assignment

Staff scheduling complexity belongs only where required by an approved design.

## Exit Criteria

Phase B is complete when:
- authorized tenant admins can create/update staff;
- staff can be activated/deactivated safely;
- staff remains bound to the correct tenant;
- unauthorized and cross-tenant operations fail closed;
- inactive staff behavior is enforced by server-side domain rules;
- relevant tests and CI remain green.

## Next Phase

Phase C — Service Management.
