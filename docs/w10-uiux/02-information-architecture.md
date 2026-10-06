# W10 Information Architecture

## Public
- /[tenant-slug]
- public catalog
- booking flow
- booking result

## Authenticated
- dashboard shell
- appointments/calendar
- staff
- services
- working hours
- customer history

## Role navigation
TENANT_ADMIN: management + calendar + customer context + appointment actions allowed by server contract.

STAFF: own appointment workload + authorized appointment decision actions.

CUSTOMER: customer-facing history only where an approved authenticated customer contract exists; public booking remains unauthenticated.

## Navigation rule
Do not expose navigation items as a substitute for authorization. The server remains authoritative.
