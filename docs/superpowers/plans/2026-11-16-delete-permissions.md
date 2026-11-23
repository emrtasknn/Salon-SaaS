# Delete Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Role-scoped archive ("soft") delete for tenant, staff, service, customer, customer note and appointment, behind a confirmation dialog, with server-side rules that block harmful deletes.

**Architecture:** One additive migration adds `deletedAt` to five tables. Each entity gets a delete use case in `src/application` (authorization + rules) backed by a Prisma repository that re-checks the rule and writes inside one tenant-context transaction. Every read path filters `deletedAt: null`. The UI gets one shared confirm dialog and delete buttons that call new server actions.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7, PostgreSQL RLS, Vitest, ESLint 9.

**Spec:** `docs/superpowers/specs/2026-11-16-delete-permissions-design.md` — read it before your task.

## Global Constraints

- Never run `npm test`, any `*.integration.test.ts`, `prisma migrate *`, seed scripts or SQL locally. Unit tests only: `npx vitest run <file>` with `DATABASE_URL` unset.
- No RLS policy change. No change to `src/application/booking-engine.ts`, `src/persistence/prisma-booking-engine.ts`, `src/domain/appointment.ts` transitions or `src/domain/availability.ts`.
- Tenant id always comes from the authenticated server context; the client sends only record ids (and the typed slug for tenant delete).
- Cross-tenant or unknown ids resolve to `NOT_FOUND`.
- "Future active appointment" means `status IN (PENDING, CONFIRMED) AND startAt > now`; `now` is injected (`now?: () => Date`).
- Erased-customer placeholder is exactly `Silinmiş müşteri`.
- No new dependency. No existing test removed or weakened.
- All user-facing copy is Turkish.
- Each task ends with `npm run lint` and `npm run typecheck` clean.

## Agent ownership

| Task | Agent |
|---|---|
| 1 | `salon-saas-database` (proposal only; owner applies) |
| 2–7 | `salon-saas-backend` |
| 8 | `salon-saas-backend` (owner-approved exception: may edit `src/app/**/actions.ts` and `src/app/appointment-create-contract.ts` only) |
| 9–10 | `salon-saas-uiux` |
| 11 | `salon-saas-qa` |
| 12 | `salon-saas-reviewer` |

Order: 1 → 2 → (3, 4, 5, 6, 7 in sequence; they share read-path files) → 8 → 9 → 10 → 11 → 12.

## Review Focus

1. A booking is created for a staff member or service at the same moment it is deleted → the delete or the booking must lose cleanly; never an active appointment on an archived staff/service. (Task 4, 5: `FOR UPDATE` on the tenant row, integration test in Task 11.)
2. Delete is submitted twice (double click, retry) → second call returns `NOT_FOUND`, no error, no second write. (Tasks 3–7 unit tests.)
3. A deleted staff member still holds a valid session cookie → every action returns forbidden because the membership row is gone. (Task 4 test; Task 11 integration.)
4. Tenant slug typed with different case or surrounding spaces → `CONFIRMATION_MISMATCH`; comparison is exact. (Task 7 test.)
5. A past appointment whose customer was erased is opened in the calendar → shows `Silinmiş müşteri`, no crash on null phone/email. (Task 6 test; Task 10 UI check.)

---

### Task 1: Schema and migration proposal

**Files:**
- Modify: `prisma/schema.prisma` (models `Tenant`, `Staff`, `Service`, `Profile`, `Appointment`)
- Create: `prisma/migrations/20261116100000_soft_delete_columns/migration.sql`
- Modify: `docs/RLS_TENANT_ISOLATION.md` (one paragraph: columns added, policies unchanged)

**Interfaces:**
- Produces: Prisma field `deletedAt: Date | null` on the five models.

- [ ] **Step 1:** Add `deletedAt DateTime?` to each of the five models.
- [ ] **Step 2:** Write the migration: five `ALTER TABLE ... ADD COLUMN "deletedAt" TIMESTAMP(3);` statements, nothing else. No index, no policy, no backfill.
- [ ] **Step 3:** Run `npx prisma generate` (does not connect), then `npm run typecheck`. Expected: clean.
- [ ] **Step 4:** Commit `feat(db): add deletedAt columns (proposal, not applied)`.

Do not apply the migration anywhere.

### Task 2: Shared deletion domain

**Files:**
- Create: `src/domain/deletion.ts`
- Test: `src/domain/deletion.test.ts`

**Interfaces:**
- Produces:

```ts
export const DELETED_CUSTOMER_NAME = "Silinmiş müşteri";
export type DeleteFailureCode =
  | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "NOT_DELETABLE"
  | "MUST_CANCEL_FIRST" | "TENANT_ACTIVE" | "CONFIRMATION_MISMATCH" | "PERSISTENCE_FAILURE";
export type DeleteResult =
  | { status: "DELETED" }
  | { status: DeleteFailureCode }
  | { status: "HAS_ACTIVE_APPOINTMENTS"; count: number };
/** Non-empty, trimmed, <= 100 chars, no control characters. */
export function isRecordId(value: unknown): value is string;
export type AppointmentDeleteActor = "TENANT_ADMIN" | "ASSIGNED_STAFF";
export function appointmentDeleteRule(
  actor: AppointmentDeleteActor, status: AppointmentStatus,
): "ALLOWED" | "MUST_CANCEL_FIRST" | "FORBIDDEN";
```

- [ ] **Step 1: Failing tests.** `appointmentDeleteRule`: all 10 actor × status cells — PENDING/CONFIRMED → `MUST_CANCEL_FIRST` for both; REJECTED/CANCELLED → `ALLOWED` for both; COMPLETED → `ALLOWED` for admin, `FORBIDDEN` for staff. `isRecordId`: rejects `""`, `" a"`, 101 chars, `"a\u0000"`, `42`, `null`; accepts a cuid.
- [ ] **Step 2:** Run `npx vitest run src/domain/deletion.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. Commit `feat(domain): deletion rules`.

### Task 3: Appointment delete

**Files:**
- Create: `src/application/appointment-deletion.ts`, `src/persistence/prisma-appointment-deletion.ts`
- Modify: `src/application/staff-appointment-authorization.ts` (add `authorizeStaffAppointmentDelete`)
- Modify (add `deletedAt: null` to appointment reads): `src/persistence/prisma-calendar-crm.ts`, `prisma-staff-appointments.ts`, `prisma-appointment-access-token.ts`, `prisma-in-app-notifications.ts`, `prisma-closure-dates.ts` (`readImpact`), `src/app/admin/dashboard-summary.ts` if it queries directly
- Test: `src/application/appointment-deletion.test.ts`, `src/persistence/prisma-appointment-deletion.test.ts`, extend `staff-appointment-authorization.test.ts`

**Interfaces:**
- Consumes: Task 2 exports.
- Produces:

```ts
export type AppointmentDeletionRepository = Readonly<{
  find(tenantContext: TenantContext, id: string): Promise<AppointmentRecord | null>; // null when missing or already archived
  archive(tenantContext: TenantContext, id: string, at: Date): Promise<"archived" | "not_found" | "not_terminal">;
}>;
export function createAppointmentDeletion(deps: Readonly<{
  repository: AppointmentDeletionRepository;
  authorizer: {
    authorizeAdmin(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean>;
    authorizeAssignedStaff(identity: ApplicationIdentity, tenantContext: TenantContext, appointment: AppointmentRecord): Promise<boolean>;
  };
  now?: () => Date;
}>): { delete(identity: ApplicationIdentity, tenantContext: TenantContext, appointmentId: unknown): Promise<DeleteResult> };
export function createPrismaAppointmentDeletionRepository(prisma: PrismaTenantClient): AppointmentDeletionRepository;
// staff-appointment-authorization.ts
export async function authorizeStaffAppointmentDelete(deps, identity, tenantContext, appointment): Promise<boolean>; // assigned ACTIVE staff, any status
```

`archive` updates with `where: { tenantId, id, deletedAt: null, status: { in: ["REJECTED","CANCELLED","COMPLETED"] } }` so a concurrent status change cannot slip through; when count is 0 it re-reads to tell `not_found` from `not_terminal`.

- [ ] **Step 1: Failing tests** (application): unauthenticated → `FORBIDDEN`; invalid id → `INVALID_INPUT`; missing → `NOT_FOUND`; admin + CANCELLED → `DELETED`; admin + COMPLETED → `DELETED`; admin + CONFIRMED → `MUST_CANCEL_FIRST`; assigned staff + REJECTED → `DELETED`; assigned staff + COMPLETED → `FORBIDDEN`; non-assigned staff + CANCELLED → `FORBIDDEN`; repository `not_terminal` → `MUST_CANCEL_FIRST`; second delete → `NOT_FOUND`; repository throws → `PERSISTENCE_FAILURE`. Admin is checked first; staff path only when admin check is false.
- [ ] **Step 2: Failing tests** (persistence, fake client as in `prisma-closure-dates.test.ts`): `archive` passes the `where` above and `data: { deletedAt: at }`; each modified read passes `deletedAt: null`.
- [ ] **Step 3:** Run both → FAIL. Implement. Run → PASS.
- [ ] **Step 4:** Commit `feat: appointment archive delete`.

### Task 4: Staff delete

**Files:**
- Create: `src/application/staff-deletion.ts`, `src/persistence/prisma-staff-deletion.ts`
- Modify (staff reads filter `deletedAt: null`): `src/persistence/prisma-staff-management.ts`, `prisma-staff-lookup.ts`, `prisma-staff-services.ts`, `prisma-public-vitrin.ts`, `prisma-public-availability.ts`, `prisma-public-booking.ts` (staff listing only; do not touch booking creation)
- Test: `src/application/staff-deletion.test.ts`, `src/persistence/prisma-staff-deletion.test.ts`

**Interfaces:**
- Produces:

```ts
export type StaffDeletionRepository = Readonly<{
  archive(tenantContext: TenantContext, input: Readonly<{ staffId: string; actorProfileId: string; now: Date }>): Promise<
    | "archived" | "not_found" | "is_self" | "not_staff_role"
    | { status: "has_active_appointments"; count: number }
  >;
}>;
export function createStaffDeletion(deps: Readonly<{
  repository: StaffDeletionRepository;
  authorizer: { authorizeAdmin(identity: ApplicationIdentity, tenantContext: TenantContext): Promise<boolean> };
  now?: () => Date;
}>): { delete(identity: ApplicationIdentity, tenantContext: TenantContext, staffId: unknown): Promise<DeleteResult> };
export function createPrismaStaffDeletionRepository(prisma: PrismaTenantClient): StaffDeletionRepository;
```

`archive` runs in one `withPrismaTenantContext` transaction, in this order:
1. `SELECT "id" FROM "Tenant" WHERE "id" = $tenantId FOR UPDATE` (same lock closure-create uses; serializes against bookings' `FOR SHARE`).
2. Load staff (`deletedAt: null`) with `profileId`; missing → `not_found`. `profileId === actorProfileId` → `is_self`.
3. Load memberships for that profile; any role other than `STAFF` → `not_staff_role`.
4. Count future active appointments for `staffId`; > 0 → `has_active_appointments`.
5. Write: `staff.update { deletedAt: now, status: "INACTIVE" }`; `staffService.deleteMany { staffId }`; `tenantMembership.deleteMany { profileId }`; `pushSubscription.updateMany { profileId, revokedAt: null } → { revokedAt: now }`; `profile.update { email: null }`.

Mapping: `is_self` and `not_staff_role` → `NOT_DELETABLE`.

- [ ] **Step 1: Failing tests** (application): non-admin → `FORBIDDEN`; invalid id; each repository outcome maps as above; `has_active_appointments` carries `count`; throw → `PERSISTENCE_FAILURE`.
- [ ] **Step 2: Failing tests** (persistence, fake tx recording calls): order is lock → reads → count → writes; no write happens on any blocked outcome; count query uses `status in [PENDING, CONFIRMED]` and `startAt > now` and `deletedAt: null`; all five writes are issued with `tenantId` in the `where`.
- [ ] **Step 3:** FAIL → implement → PASS. Commit `feat: staff archive delete`.

### Task 5: Service delete

**Files:**
- Create: `src/application/service-deletion.ts`, `src/persistence/prisma-service-deletion.ts`
- Modify (service reads filter `deletedAt: null`): `src/persistence/prisma-service-management.ts`, `prisma-staff-services.ts`, `prisma-service-categories.ts` (counts, if any), `prisma-public-vitrin.ts`, `prisma-public-availability.ts`, `prisma-public-booking.ts` (listing only)
- Test: `src/application/service-deletion.test.ts`, `src/persistence/prisma-service-deletion.test.ts`

**Interfaces:**
- Produces: `createServiceDeletion(deps)` with `delete(identity, tenantContext, serviceId: unknown): Promise<DeleteResult>` and `createPrismaServiceDeletionRepository(prisma)`, same shapes as Task 4 with repository outcomes `"archived" | "not_found" | { status: "has_active_appointments"; count }`.

Transaction: tenant `FOR UPDATE` → load service → count future active appointments where `serviceId = id` OR an `AppointmentService` row references it → write `service.update { deletedAt: now, <active flag>: false }` (use the existing active field of `Service`) and `staffService.deleteMany { serviceId }`.

- [ ] **Step 1: Failing tests** mirroring Task 4, plus: an appointment that references the service only through `AppointmentService` blocks the delete.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: service archive delete`.

### Task 6: Customer and note delete

**Files:**
- Create: `src/application/customer-deletion.ts`, `src/persistence/prisma-customer-deletion.ts`
- Modify: `src/persistence/prisma-calendar-crm.ts` (customer list, customer detail and customer search exclude `deletedAt` profiles), the customer search used by `searchAdminCustomers` / appointment create
- Test: `src/application/customer-deletion.test.ts`, `src/persistence/prisma-customer-deletion.test.ts`

**Interfaces:**
- Produces:

```ts
export function createCustomerDeletion(deps): {
  deleteCustomer(identity, tenantContext, customerProfileId: unknown): Promise<DeleteResult>;
  deleteNote(identity, tenantContext, noteId: unknown): Promise<DeleteResult>;
};
export type CustomerDeletionRepository = Readonly<{
  erase(tenantContext, input: Readonly<{ profileId: string; now: Date }>): Promise<
    "erased" | "not_found" | "not_customer" | { status: "has_active_appointments"; count: number }>;
  deleteNote(tenantContext, noteId: string): Promise<"deleted" | "not_found">;
}>;
```

`erase` transaction: load profile (`deletedAt: null`) → has a `Staff` row or any `TenantMembership` → `not_customer` → count future active appointments by `customerProfileId` → writes: `profile.update { deletedAt: now, displayName: DELETED_CUSTOMER_NAME, email: null, phone: null }`; `customerNote.deleteMany { customerProfileId }`; `appointmentContact.updateMany` for that customer's appointments `{ displayName: DELETED_CUSTOMER_NAME, email: null, phone: null }`. Consent fields (`notice*`, `optIn*`, `optOutAt`, `whatsappOptIn`) are not written.

`not_customer` → `NOT_DELETABLE`. Both operations require TENANT_ADMIN.

- [ ] **Step 1: Failing tests** (application): role, input, each mapping, double delete → `NOT_FOUND`.
- [ ] **Step 2: Failing tests** (persistence): `appointmentContact.updateMany` data has exactly the three keys; no write on blocked outcomes; note delete uses `deleteMany { tenantId, id }`; list/detail/search pass `deletedAt: null`.
- [ ] **Step 3:** FAIL → implement → PASS. Commit `feat: customer erasure and note delete`.

### Task 7: Tenant delete

**Files:**
- Modify: `src/application/platform-tenant-status.ts`, `src/persistence/prisma-platform-tenants.ts`, `src/persistence/prisma-membership-reader.ts`, `src/persistence/prisma-public-vitrin.ts`
- Test: `src/application/platform-tenant-status.test.ts`, `src/persistence/prisma-membership-reader.test.ts`, new `src/persistence/prisma-platform-tenants.test.ts`

**Interfaces:**
- Produces, added to the object returned by `createPlatformTenantStatus`:

```ts
delete(actor: PlatformActor, input: Readonly<{ tenantId: unknown; confirmSlug: unknown }>, now?: Date): Promise<DeleteResult>;
```

and on `PlatformTenantRepository`:

```ts
archive(tenantId: string, confirmSlug: string, at: Date): Promise<"archived" | "not_found" | "active" | "slug_mismatch">;
```

- `archive`: read tenant (`deletedAt: null`) → `status === "ACTIVE"` → `active`; `slug !== confirmSlug` (exact, no trim, no case folding) → `slug_mismatch`; then `updateMany { where: { id, deletedAt: null, status: "INACTIVE" }, data: { deletedAt: at } }`.
- `list()` filters `deletedAt: null`. `setStatus` adds `deletedAt: null` to its `where` so an archived tenant cannot be reactivated.
- `prisma-membership-reader.ts`: return `not_found` when the membership's tenant has `deletedAt` set. This is the single authorization choke point; it is a read filter only, flag it for the reviewer as auth-adjacent.
- `prisma-public-vitrin.ts`: slug lookup treats an archived tenant as missing.

Mapping: `active` → `TENANT_ACTIVE`, `slug_mismatch` → `CONFIRMATION_MISMATCH`.

- [ ] **Step 1: Failing tests:** non-super-admin → `FORBIDDEN`; non-string or empty `confirmSlug` → `INVALID_INPUT`; ACTIVE tenant → `TENANT_ACTIVE`; `"Salon-A"` or `" salon-a"` against slug `salon-a` → `CONFIRMATION_MISMATCH`; exact → `DELETED`; second call → `NOT_FOUND`; `setStatus` on archived → `NOT_FOUND`; membership reader returns `not_found` for an archived tenant.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: tenant archive delete`.

### Task 8: Server actions

**Files:**
- Modify: `src/app/admin/actions.ts` (`deleteStaffAction(staffId: string)`, `deleteServiceAction(serviceId: string)`), `src/app/admin/customers/actions.ts` (`deleteCustomerAction(id: string)`, `deleteCustomerNoteAction(noteId: string)`), `src/app/admin/calendar-actions.ts` (`deleteAdminAppointment(appointmentId: string)`), `src/app/staff/actions.ts` (`deleteStaffAppointment(appointmentId: string)`), `src/app/platform/tenants/actions.ts` (`deleteTenantAction(formData: FormData)` reading `tenantId`, `confirmSlug`)
- Test: extend the existing action/runtime tests next to these files where they exist

**Interfaces:**
- Consumes: factories from Tasks 3–7.
- Produces: each action returns `Promise<DeleteResult>`; a missing or unauthorized context returns `{ status: "FORBIDDEN" }`; any thrown error returns `{ status: "PERSISTENCE_FAILURE" }`.

Reuse each file's existing context helper and `enforceServerAuthorization` wiring unchanged. `deleteStaffAppointment` wires `authorizeAssignedStaff` to `authorizeStaffAppointmentDelete` with the file's existing `membershipReader`/`staffReader`, and `authorizeAdmin` to the TENANT_ADMIN check already used in that file. Call `revalidatePath` only if the neighbouring actions in that file already do.

- [ ] **Step 1:** Write tests where a harness exists (context null → `FORBIDDEN`).
- [ ] **Step 2:** Implement; `npm run lint && npm run typecheck`. Commit `feat: delete server actions`.

### Task 9: Confirm dialog component

**Files:**
- Create: `src/app/_ui/confirm-dialog.tsx`, `src/app/_ui/delete-messages.ts`
- Test: `src/app/_ui/confirm-dialog.test.tsx`, `src/app/_ui/delete-messages.test.ts`

**Interfaces:**
- Produces:

```tsx
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;          // default "Sil"
  requireText?: string;           // when set, confirm stays disabled until the input equals it exactly
  requireTextLabel?: string;
  pending?: boolean;
  error?: string | null;
  onConfirm(typedText?: string): void;
  onCancel(): void;
}): JSX.Element | null;
// delete-messages.ts
export function deleteErrorMessage(result: Exclude<DeleteResult, { status: "DELETED" }>): string;
```

Requirements: `role="alertdialog"`, `aria-modal`, labelled by title and description; focus moves to the cancel button on open and returns to the trigger on close; Tab is trapped; Escape and backdrop cancel unless `pending`; destructive styling on confirm; both buttons disabled while `pending`. Follow `.claude/skills/salon-saas-uiux/SKILL.md` and existing `Button`/`Notice` primitives.

`deleteErrorMessage` copy: `HAS_ACTIVE_APPOINTMENTS` → `` `${count} ileri tarihli aktif randevu var. Önce iptal edin veya taşıyın.` ``; `MUST_CANCEL_FIRST` → `Aktif randevu silinemez. Önce iptal edin.`; `TENANT_ACTIVE` → `Önce salonu pasif duruma alın.`; `CONFIRMATION_MISMATCH` → `Yazdığınız adres eşleşmiyor.`; `NOT_DELETABLE` → `Bu kayıt silinemez.`; `NOT_FOUND` → `Kayıt bulunamadı veya zaten silinmiş.`; `FORBIDDEN` → `Bu işlem için yetkiniz yok.`; others → `Silinemedi. Lütfen tekrar deneyin.`

- [ ] **Step 1: Failing tests:** not rendered when closed; alertdialog role and labels; Escape calls `onCancel`; Escape ignored while pending; with `requireText="salon-a"` confirm is disabled for `"Salon-A"` and enabled for `"salon-a"`; `error` is rendered; every message mapping above.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat(ui): confirm dialog`.

### Task 10: Delete buttons

**Files:**
- Modify: `src/app/platform/tenants/tenant-status-list.tsx`, `src/app/admin/staff/staff-management.tsx`, `src/app/admin/services/service-management.tsx`, `src/app/admin/customers/customer-list.tsx` (customer detail and each note), `src/app/admin/calendar.tsx` and `src/app/staff/calendar.tsx` / `src/app/staff/appointments.tsx` (appointment detail), `src/app/admin/closures.tsx`, `src/app/admin/hours/working-hours-editor.tsx`
- Test: extend the existing component tests beside these files

**Interfaces:**
- Consumes: Task 8 actions, Task 9 `ConfirmDialog` and `deleteErrorMessage`.

Per screen: a delete button opens `ConfirmDialog`; confirm calls the action in a transition; `DELETED` closes the dialog and refreshes the list the same way the screen already refreshes after its other mutations; any other result stays open and shows `deleteErrorMessage(result)`.

Visibility: tenant button only on INACTIVE rows, with `requireText={tenant.slug}`; staff button not shown on the current admin's own row; appointment button only for REJECTED/CANCELLED (and COMPLETED in the admin calendar). Dialog descriptions state the consequence: staff "giriş erişimi kapatılır, geçmiş randevular korunur"; customer "ad, telefon, e-posta ve notlar kalıcı olarak silinir, geri alınamaz"; tenant "salon ve tüm kullanıcılarının erişimi kapatılır".

Existing category, closure and working-hours deletes are routed through `ConfirmDialog` with no change to their actions.

- [ ] **Step 1:** Tests per screen: button visibility rules above; confirm calls the action with the record id; a blocked result renders the message and keeps the dialog open.
- [ ] **Step 2:** Implement; run the touched tests, lint, typecheck.
- [ ] **Step 3:** Check each screen at 375 px and desktop width in light and dark theme. Commit `feat(ui): delete buttons with confirmation`.

### Task 11: Integration tests and full verification

**Files:**
- Create: `src/persistence/prisma-soft-delete.integration.test.ts`
- Modify: `docs/RLS_TENANT_ISOLATION.md` test list if it enumerates suites

Tests (written here, executed only by CI):
- Tenant B context cannot archive tenant A's staff, service, customer, note or appointment (`not_found`, row unchanged).
- Staff archive removes the membership; membership reader then returns `not_found`.
- Staff/service archive with a future CONFIRMED appointment is blocked and writes nothing.
- Customer erase clears profile and contact PII, deletes notes, keeps consent fields.
- Archived appointment, staff, service and customer are absent from each list repository.
- Archived tenant: membership reader `not_found`, vitrin lookup missing.
- Concurrency: booking and staff archive in parallel never leave an active appointment on an archived staff member (model on `prisma-booking-concurrency.integration.test.ts`).

- [ ] **Step 1:** Write the suite following the fixture/cleanup style of `prisma-management-tenant-isolation.integration.test.ts`. Do not run it.
- [ ] **Step 2:** Run `npm run lint`, `npm run typecheck`, `npm run build`, and every unit test file touched by Tasks 2–10 by path. Report output.
- [ ] **Step 3:** List what only CI proves. Commit `test: soft delete integration suite`.

### Task 12: Independent review

- [ ] Review the whole branch diff against the spec: matrix cells, each blocking rule, tenant isolation on every new write, the membership-reader change, absence of booking-engine changes, read-path coverage (grep for `findMany|findFirst|findUnique|count|\$queryRaw` on the five models and confirm each either filters `deletedAt` or is intentionally exempt, with the reason).
- [ ] Report findings by severity. No edits.

## Follow-ups (not in this plan)

- Removing the Supabase auth user of a deleted staff member (`auth-admin-provisioning.ts` has no delete today; needs its own review).
- Restore UI, `deletedBy` audit, tenant hard purge, slug reuse.
