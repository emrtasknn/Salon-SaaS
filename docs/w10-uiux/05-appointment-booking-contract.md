# W10 Appointment + Booking UX Contract

## Appointment states
PENDING → CONFIRMED / REJECTED / CANCELLED
CONFIRMED → COMPLETED / CANCELLED
REJECTED / CANCELLED / COMPLETED → terminal

## UI behavior
- PENDING: show only authorized decision actions.
- CONFIRMED: show only authorized completion/cancellation actions.
- Terminal: status/history presentation, no invalid actions.
- Server response is authoritative after every mutation.

## Booking
1. service
2. staff when applicable
3. date/time
4. customer details
5. submit
6. result

Required result handling:
- success
- invalid input
- slot unavailable
- invalid resource
- persistence failure

The UI must not promise a slot solely from a client-side availability calculation.
