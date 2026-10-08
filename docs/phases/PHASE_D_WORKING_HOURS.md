# Phase D — Working Hours

## Status

Planned after Phase C.

## Goal

> The system knows when booking is possible.

## Approved Scope

- weekly hours
- closed days
- timezone-aware boundaries
- staff-specific schedule only if required by approved design

## Existing Context

The repository already contains working-hours management application/persistence flows and admin actions.

The current persistence model stores:
- tenant
- day of week
- opening minute
- closing minute

Phase D should validate and harden this capability against the approved boundary.

## Booking Dependency

Working hours become a direct input to the Booking Engine.

The Booking Engine must later combine working hours with:
- tenant timezone
- service duration
- service buffer
- staff availability
- existing appointments
- transactional availability re-check

Phase D itself should not absorb Booking Engine responsibilities.

## Security Invariants

- Working hours are tenant-owned.
- Tenant context is trusted server-side.
- Cross-tenant access is blocked.
- Unauthorized changes are rejected.
- Time boundaries are validated server-side.
- Timezone semantics are explicit.

## Scope Boundaries

Do not silently introduce:
- holiday calendars
- arbitrary date exceptions
- seasonal schedules
- complex split shifts
- resource schedules

Such complexity requires separate product/architecture approval.

## Exit Criteria

Phase D is complete when:
- authorized tenant admins can define weekly working hours;
- closed days are representable;
- invalid boundaries are rejected;
- tenant ownership is enforced;
- timezone behavior is explicit;
- relevant tests and CI remain green.

## Next Phase

Booking Engine — highest-risk product logic.
