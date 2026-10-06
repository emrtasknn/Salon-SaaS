# W10 Product UX Map

## Primary journey
Tenant Setup → Staff → Services → Working Hours → Public Vitrin → Customer Booking → Admin sees request → Staff/Admin decision → Appointment → Complete → Customer History

## Operational goals
- Admin: configure salon and see/act on today's operational workload.
- Staff: see assigned appointments and make only authorized decisions.
- Customer: discover services, choose a valid slot, submit a booking, understand the result.
- Public visitor: understand salon/service offering without exposing tenant-internal data.

## Failure branches
- unauthorized action
- missing/invalid input
- slot unavailable
- inactive/unavailable resource
- persistence failure
- notification failure

## Security invariant
UI visibility never grants authority. Protected actions are server-authorized using trusted identity and tenant context.
