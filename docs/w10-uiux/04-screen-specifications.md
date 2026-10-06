# W10 Screen Specifications

## Admin shell / dashboard
Purpose: orient the admin to today's work.
Focal point: pending/active appointments and next operational action.
States: loading, empty, error, success.
No invented KPI data.

## Staff appointment view
Purpose: let staff understand today's assigned workload and act on valid pending requests.
Focal point: next/pending appointment.
Actions must follow server-authoritative lifecycle.

## Management screens
Staff, Services, Working Hours.
Each has list + create/edit flow where existing application contracts support it.
States: empty, loading, validation error, conflict, persistence failure, success.

## Admin calendar / appointment detail
Purpose: inspect schedule and take valid actions.
Do not render impossible state transitions.

## Public vitrin
Purpose: communicate tenant, active services, staff and working hours.
No internal identifiers, roles, notes, notification data, or management controls.

## Public booking
Purpose: service → staff → date/time → customer details → submit → authoritative result.
Availability is advisory until server acceptance.

## Customer history
Purpose: tenant-safe appointment history and approved notes context.
No cross-tenant rendering.
