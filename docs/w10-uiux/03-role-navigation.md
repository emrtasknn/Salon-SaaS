# W10 Role / Capability Matrix

| Area | TENANT_ADMIN | STAFF | CUSTOMER | Public |
|---|---|---|---|---|
| Staff management | manage | hidden | hidden | hidden |
| Services | manage | hidden | public read | public read |
| Working hours | manage | read only if required by approved screen contract | hidden | public-safe read |
| Calendar | manage | own workload | own approved history only | hidden |
| Appointment decision | authorized | authorized decision path | no | no |
| Customer history | authorized tenant context | only if explicitly approved by application contract | own history | no |
| Public vitrin | preview/use | use | use | use |
| Booking | no special UI authority | no special UI authority | submit public flow | submit public flow |

This matrix is UX visibility guidance. It is not an authorization policy.
