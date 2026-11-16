# Delete permissions — design

Status: awaiting owner approval · Date: 2026-11-16 · Change class: C2/C3 (schema migration, membership revocation, KVKK data)

## Intent

Owners, admins and staff need a way to remove records that are wrong or no longer wanted (a salon that left, a staff member who quit, a mistyped customer, a cancelled appointment cluttering the list). Today these can only be deactivated or cancelled. The owner wants a delete button with a confirmation screen, and wants mistaken or harmful deletes to be prevented.

## Goals

- Role-scoped delete for tenant, staff, service, customer, customer note and appointment.
- Every delete goes through a confirmation dialog that names the record and states the consequence.
- Server-side rules block deletes that would harm a customer or break history.
- History, reports and notification records stay intact.

## Non-goals

- Restore/"trash" UI. Archived rows are recoverable by support through the database only.
- Hard purge of an archived tenant. That stays a separate, manually approved operation.
- Deleting a TENANT_ADMIN account. Admin accounts are out of scope.
- Freeing the slug of an archived tenant.
- Any RLS policy change.

## Anti-goals

- No change to the appointment state machine or to the conflict/availability rules.
- No delete that silently removes a customer's upcoming appointment.
- No authorization decision based on anything the client sends other than the record id.

## Approaches considered

1. **Archive (soft delete) — chosen by the owner.** Mark the row with `deletedAt`; hide it everywhere; keep history. Customer personal data is actually erased. Costs one additive migration and a filter on every read.
2. **Hard delete.** Almost every relation is `onDelete: Restrict`, so this needs cascading manual deletes across up to 16 tables and loses appointment history. Irreversible. Rejected as the riskiest path.
3. **Mixed** (hard delete when no history, archive otherwise). Cleanest data, but two code paths and twice the tests. Rejected for size.

## Permission matrix (owner-approved)

| Entity | SUPER_ADMIN | TENANT_ADMIN | STAFF |
|---|---|---|---|
| Tenant | yes | no | no |
| Staff | no | yes | no |
| Service | no | yes | no |
| Customer | no | yes | no |
| Customer note | no | yes | no |
| Appointment | no | yes, any in tenant | yes, own only |
| Category, closure, working hours (existing) | no | yes | no |

SUPER_ADMIN does not delete data inside a tenant; the platform role has no tenant-data access today and that is preserved.

## Rules per entity

Each rule is enforced in the application layer and re-checked inside the same transaction as the write.

**Tenant** (SUPER_ADMIN)
- Tenant must already be `INACTIVE`; otherwise `TENANT_ACTIVE`.
- The request carries the slug typed by the user; the server compares it to the stored slug; mismatch gives `CONFIRMATION_MISMATCH`.
- Effect: `Tenant.deletedAt` set. The tenant disappears from the platform list, slug resolution (public pages, booking, status links) and login/tenant binding.

**Staff** (TENANT_ADMIN)
- Target must be a STAFF-role member. An admin cannot delete themself, and admin accounts are not deletable here (`NOT_DELETABLE`).
- Blocked while the staff member has any PENDING or CONFIRMED appointment (regardless of `startAt`): `HAS_ACTIVE_APPOINTMENTS` (response includes the count).
- Effect: `Staff.deletedAt` set and `status = INACTIVE`; the member's `TenantMembership` row deleted (this is what revokes access); their push subscriptions revoked; `StaffService` rows deleted; `Profile.email` cleared so the address can be reused. `Profile.displayName` is kept so past appointments still show who served.

**Service** (TENANT_ADMIN)
- Blocked while it has any PENDING or CONFIRMED appointment (regardless of `startAt`), as primary service or through `AppointmentService`: `HAS_ACTIVE_APPOINTMENTS`.
- Effect: `Service.deletedAt` set and the service deactivated; `StaffService` rows deleted.

**Customer** (TENANT_ADMIN)
- Target profile must be a customer (no `Staff` row, no membership); otherwise `NOT_DELETABLE`.
- Blocked while the customer has any PENDING or CONFIRMED appointment (regardless of `startAt`): `HAS_ACTIVE_APPOINTMENTS`.
- Effect (KVKK erasure): `Profile.deletedAt` set, `displayName` replaced with a fixed placeholder, `email` and `phone` cleared; all `CustomerNote` rows hard-deleted; on the customer's `AppointmentContact` rows `displayName` replaced and `email`/`phone` cleared, and WhatsApp opt-in status and opt-in evidence (`whatsappOptIn`, opt-in version/hash/time/recorder, opt-out time) are cleared. KVKK notice evidence (notice version, hash, shown-at) is kept.

**Customer note** (TENANT_ADMIN)
- Hard delete of one note. A DELETE policy already exists.

**Appointment** (TENANT_ADMIN any; STAFF own only, using the existing staff-appointment authorization)
- PENDING or CONFIRMED cannot be deleted: `MUST_CANCEL_FIRST`. The user cancels through the existing flow first.
- REJECTED and CANCELLED: admin or the owning staff member.
- COMPLETED: admin only.
- Effect: `Appointment.deletedAt` set. Hidden from calendars, lists, dashboard summary, customer history and in-app notifications; the customer status link returns not-found. Child rows (`NotificationDelivery`, `AppointmentContact`, `AppointmentAccessToken`, `AppointmentService`) are left in place.

Because only terminal-status appointments can be archived, and archived staff/services are also deactivated, the conflict query and booking checks need no change.

## Data model

One additive migration, no RLS change:

- `deletedAt TIMESTAMP(3) NULL` on `Tenant`, `Staff`, `Service`, `Profile`, `Appointment`.

The core tables' tenant-isolation policy is `FOR ALL`, so the existing policies already scope these updates and the membership delete to the tenant. The migration is drafted as a proposal; the owner applies it. Nothing is run against a live database.

## Read paths that must exclude archived rows

`prisma-calendar-crm`, `prisma-staff-appointments`, `prisma-staff-management`, `prisma-staff-lookup`, `prisma-staff-services`, `prisma-service-management`, `prisma-public-vitrin`, `prisma-public-availability`, `prisma-public-booking`, `prisma-appointment-access-token`, `prisma-in-app-notifications`, `prisma-closure-dates`, `prisma-platform-tenants`, `prisma-tenant-settings`, `prisma-tenant-context` / tenant resolution, `admin/calendar-actions`, `admin/dashboard-summary`, `staff/actions`, `_ui/viewer-greeting`.

Customer search and customer list exclude archived profiles. A past appointment whose customer was erased shows the placeholder name.

`prisma-booking-engine` is not changed (booking semantics).

## UI

- One shared confirm dialog component (`role="alertdialog"`, focus trapped, Escape and the secondary button cancel, destructive primary button, pending state, error line). Follows `.claude/skills/salon-saas-uiux/SKILL.md`.
- The dialog names the record and states the consequence in Turkish. For a tenant it also requires typing the slug before the button enables.
- A blocked delete shows the reason and what to do next (for example "3 aktif randevu var; önce tamamlayın, iptal edin veya taşıyın").
- Delete buttons: platform tenant list (inactive tenants only), admin staff list, admin services, customer detail (customer and each note), admin and staff appointment detail (terminal statuses only).
- Existing category, closure and working-hours deletes are routed through the same dialog.

The button's visibility is convenience only; the server decides.

## Result codes

`ok`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_INPUT`, `NOT_DELETABLE`, `HAS_ACTIVE_APPOINTMENTS`, `MUST_CANCEL_FIRST`, `TENANT_ACTIVE`, `CONFIRMATION_MISMATCH`, `PERSISTENCE_FAILURE`. Cross-tenant ids resolve to `NOT_FOUND`.

## Testing

- Unit tests per application service: every role × entity cell of the matrix, every blocking rule, input validation.
- Integration tests (CI only, isolated PostgreSQL): cross-tenant delete cannot touch another tenant; archived rows are absent from each read path; staff delete removes the membership; customer delete clears personal data.
- No existing test is removed or weakened.

## Calls made by the designer (not owner decisions — correct if wrong)

1. No restore UI; recovery is a support operation.
2. No `deletedBy` audit column; only `deletedAt`.
3. Admin accounts are not deletable in this work.
4. Staff access is revoked by deleting the membership row. Removing the Supabase auth user is done only if the existing provisioning port already supports it; otherwise it is listed as a follow-up.
5. A deleted appointment's customer status link shows not-found.
6. On customer erasure, WhatsApp opt-in status and opt-in evidence on `AppointmentContact` are cleared (erasure wins; the CHECK constraints forbid opt-in without a phone); KVKK notice evidence is kept.

## Left to the builder

File layout of new application services and repositories (follow the existing `*-management` pattern), dialog styling, exact Turkish copy, index choice for `deletedAt`.

## Amendments (2026-11-16, owner approved)

- (1) Customer erasure clears WhatsApp opt-in status and evidence while keeping KVKK notice evidence; (2) any PENDING or CONFIRMED appointment, not only future ones, blocks staff, service and customer deletes.
