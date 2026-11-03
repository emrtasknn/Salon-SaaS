# Task — WP-2b: Tenant admins as WhatsApp notification recipients

Status: **Approved by owner 2026-11-04 with the proposed defaults.** Answers to the open questions:
1. No: admins get CREATED only.
2. Reuse `appointment-created-staff`.
3. Skip admins without a phone silently.
4. The Meta-terms validation gate is not waived and still applies before production use.
5. Having no explicit opt-in is accepted for MVP as a recorded risk.

## Objective
Appointment WhatsApp notifications also reach the active TENANT_ADMIN profiles of the appointment's tenant. They go through the single shared Meta sender, keep per-recipient idempotency, and never cross tenants or create duplicates.

## Risk class
**C3**. This changes notification recipient routing (the `AGENTS.md` PWA/notification routing rule and ROADMAP's "channel schema/routing requires C3") and amends ADR-042. There is no schema change and no migration. Work stops after this plan until the owner approves it.

## Context
- Owner decision 2026-11-04: for MVP a single shared Meta WhatsApp sender is enough. It sends informational messages to staff, customers **and tenant admins**.
- MVP scope C2 was owner-approved on 2026-11-03 (`docs/PROJECT_GOVERNANCE.md` §1/§4, `docs/ROADMAP.md` "MVP scope").
- `docs/ADR-042-META-WHATSAPP-CLOUD-API.md` describes a hybrid sender policy (Proposed). It gets the addendum below.
- `docs/ADR-044-NOTIFICATION-CHANNELS.md` §10-3 sends Web Push for CREATED to the assigned staff plus all TENANT_ADMINs, deduped. This WP mirrors that for WhatsApp.
- `docs/W11.6_WHATSAPP_TENANT_ROUTING_C3.md` approves webhook routing `phone_number_id → WhatsAppIntegration → tenantId`. This WP does not change it.
- W11.5 verified the real-Meta CREATED path for staff and customer only.

### Current behaviour (verified in code)
- `src/persistence/prisma-notification.ts:23-51` `recipients()` loads the appointment by `tenantId_id`, using the server `tenantContext`.
  - CREATED goes to the staff member (`appointment-created-staff`) and the customer (`appointment-created-customer`).
  - CONFIRMED/REJECTED go to the customer only.
- All reads and writes run in `withPrismaTenantContext`, which sets `app.tenant_id` transaction-locally (`src/persistence/prisma-tenant-context.ts:34-43`).
  - `Profile` and `TenantMembership` have ENABLE + FORCE RLS (`prisma/migrations/20261005170000_rls_tenant_isolation/migration.sql`).
- Every caller derives the tenant id on the server:
  - `src/app/[slug]/book/submit.ts:8` resolves it from the slug.
  - `src/app/admin/calendar-actions.ts:111` takes it from the authenticated context.
  - `src/app/staff/decide.ts:10` takes it from the decision result.
- `src/application/notification-service.ts:83-166` handles each recipient in turn:
  - claim;
  - if there is no phone, `markFailed("RECIPIENT_PHONE_MISSING")`;
  - otherwise `provider.send`, then markSent, markFailed (rejected) or markUnknown (ambiguous).
- The idempotency key is `@@unique([tenantId, appointmentId, eventType, channel, recipientProfileId])` (`prisma/schema.prisma:189`).
  - There is no recipient-role column or enum.
  - The status enum has no SKIPPED value.
- Admins are modelled as `TenantMembership { tenantId, subjectId, profileId, role TenantRole }`, and `TenantRole` already includes `TENANT_ADMIN`.
  - The membership has no active/status field.
  - The phone exists only in `Profile.phone`.
  - No recipient has a consent/opt-in field.
- Templates map a `templateKey` to a Meta template name and language through env `WHATSAPP_TEMPLATES_JSON` (`src/app/notification-runtime.ts:9-17`).
  - An unmapped key throws `WHATSAPP_TEMPLATE_NOT_CONFIGURED` and the delivery ends up FAILED.
- Guest booking reuses an existing profile by `(tenantId, email)` (`src/persistence/prisma-public-booking.ts:54-55`). An admin's own profile can therefore be the appointment's customer.

## Decisions (proposed; owner may override — see Open questions)
1. **Recipient set.**
   - Read `TenantMembership` rows with `role = TENANT_ADMIN` inside the same `withPrismaTenantContext` transaction, with an explicit `where: { tenantId: tenantContext.tenantId, role: "TENANT_ADMIN" }` (defence in depth on top of RLS), including `profile`.
   - SUPER_ADMIN is excluded.
   - The tenant id never comes from the client.
   - "Active" means the membership row exists. Adding a status field would be a tenant-model change and is out of scope.
2. **Events.** Admins receive **APPOINTMENT_CREATED only**, consistent with ADR-044 §10-3. CONFIRMED/REJECTED stay customer-only, because admins often trigger those themselves.
3. **Phone.** The phone comes from `Profile.phone`.
   - An admin whose phone is null or blank is filtered out in `recipients()`. That admin gets no NotificationDelivery row and no provider call.
   - Staff and customer keep the current FAILED `RECIPIENT_PHONE_MISSING` behaviour.
4. **Dedupe** happens in `recipients()`. Recipients are ordered assigned staff, then customer (today's order, unchanged), then admins sorted by profileId.
   - An admin is skipped if their `profileId` is already in the list. Without this, the second claim on the same unique key would return `already_pending`.
   - Among internal recipients (staff + admins), an admin is also skipped if their digits-only phone key matches one already chosen.
   - The customer is never suppressed by phone.
5. **Template.** Admins reuse `appointment-created-staff` with the same parameters `[customer, service, time]`. This needs no new Meta approval and no env change. A dedicated admin template is optional and would need Meta approval plus a `WHATSAPP_TEMPLATES_JSON` entry.
6. **Idempotency.** No migration is needed.
   - Each admin has their own `recipientProfileId`.
   - The stored `templateKey` records which template was used.
   - The claim/markSent/markFailed/markUnknown semantics are unchanged.
7. **Service layer.** `notification-service.ts` needs no logic change. It already loops over N recipients and isolates each recipient's failure.

## Scope
**In:**
- Admin recipients for CREATED in `prisma-notification.ts`.
- A pure dedupe helper.
- Unit tests.
- The ADR-042 addendum.
- Status lines in ROADMAP and SESSION_HANDOFF.

**Out:**
- Schema/migration work (membership status, consent fields, SKIPPED status).
- Per-tenant or hybrid sender resolution.
- Shared-sender webhook routing.
- New Meta templates.
- Web Push and in-app notifications (ADR-044).
- An admin notification preferences UI.
- Removing the dead `recipientsForEvent` in `src/domain/notification.ts:25-49`, recorded as tech debt.

## Plan (one writer per file set)
| Step | Owner | Files |
|---|---|---|
| 1 | `salon-saas-backend` | `src/domain/notification.ts`: add a pure `dedupeRecipients` helper (phone key + ordering); leave `recipientsForEvent` untouched |
| 2 | `salon-saas-backend` | `src/persistence/prisma-notification.ts`: extend the `Tx` type with `tenantMembership.findMany`; for CREATED, fetch tenant-filtered TENANT_ADMIN memberships, drop null/blank phones, map them to `appointment-created-staff`, then dedupe |
| 3 | `salon-saas-qa` | `src/persistence/prisma-notification.test.ts`, `src/application/notification-service.test.ts`, `src/domain/notification.test.ts` (new if absent) |
| 4 | `salon-saas-qa` | `src/persistence/prisma-notification.integration.test.ts` (**CI only**) |
| 5 | docs | `docs/ADR-042-META-WHATSAPP-CLOUD-API.md` addendum, `docs/ROADMAP.md` status line, `docs/SESSION_HANDOFF.md` |

No step touches auth, RLS policies, booking semantics, the provider adapter or webhook code.

### Tests
**Unit tests** (`DATABASE_URL` unset):
- CREATED returns the staff member, the customer and every admin who has a phone.
- The admin `findMany` call filters on `tenantId` and `role: "TENANT_ADMIN"`.
- An admin who is also the assigned staff member is notified once, as staff.
- An admin who is also the customer gets only the customer message.
- Two admins with the same phone in different formats get one message.
- An admin whose phone equals the staff phone gets no extra message.
- An admin with no phone gets no row and no message.
- CONFIRMED/REJECTED still go to the customer only.
- Service: with 3+ recipients, one failed or unknown send does not block the others.
- Service: a re-publish does not resend to admins whose deliveries are SENT or UNKNOWN.

**CI-only integration tests** (PostgreSQL 17):
- Only admins from the same tenant are returned. An admin of tenant B is never a recipient for tenant A.
  - CI connects as a superuser, which bypasses RLS. This test therefore proves the explicit `tenantId` filter and the composite FK, not RLS itself.
  - A non-superuser `SET ROLE` variant is a follow-up.
- Several admin rows can coexist under the unique key.
- An admin who is also the staff member produces exactly one row.
- A replayed publish creates no duplicates.

**Needs real Meta:** an admin actually receiving the message through the shared sender. That is pilot evidence and needs owner approval.

### Checkpoints
1. Owner approval of this plan.
2. Steps 1–3, then lint, typecheck and targeted vitest.
3. Reviewer pass (tenant filter, dedupe, idempotency).
4. Docs step 5.
5. PR prepared; push only when asked; CI integration green before merge.

## Acceptance criteria
- [ ] CREATED notifies the assigned staff member, the customer and each same-tenant TENANT_ADMIN who has a phone, with exactly one message per profile and per internal phone.
- [ ] No admin from another tenant is ever resolved (CI integration test).
- [ ] CONFIRMED/REJECTED behaviour is unchanged.
- [ ] Idempotency is unchanged: a replay does not resend SENT, PENDING or UNKNOWN rows.
- [ ] No schema or migration change, and no new env or template key.
- [ ] ADR-042 addendum merged, recording the owner decision.
- [ ] Lint, typecheck and relevant unit tests pass; integration coverage via CI.
- [ ] No unrelated changes and no new dependency.

## Constraints
- `AGENTS.md` non-negotiables apply.
- No local integration tests or migrations while `DATABASE_URL` is set.
- No commit, push or deploy unless asked.
- No real Meta sends to admins on Pilot without explicit owner approval.

## Risks and escalation items
- **Owner approval needed:** the recipient routing change (C3) and the ADR-042 amendment.
- **Separate C3, out of scope: shared-sender webhook routing.**
  - `WhatsAppIntegration @@unique([provider, phoneNumberId])` (`schema.prisma:205`) binds the shared number to one tenant.
  - Status webhooks for every other tenant's messages fail closed. Nothing leaks, but those deliveries never move past SENT to DELIVERED or FAILED.
  - Fixing this changes the W11.6-approved routing and probably the schema. It needs a `salon-saas-database` proposal and owner approval.
- **External:**
  - Validating Meta's terms for multi-tenant shared sending is still an ADR-042 gate.
  - A new admin template would need Meta approval.
- **Consent:** no opt-in field exists for any recipient. Sending to admins and staff relies on implicit consent through their membership.
- **Volume and cost:** each CREATED now sends 2 + N(admins) template messages.
- **Latency:** sends run one after another in the booking/decision request path. Acceptable for MVP.

## Open questions (owner)
1. Should admins also receive CONFIRMED/REJECTED? Proposed: no.
2. Is reusing `appointment-created-staff` acceptable, or do you want a dedicated admin template (needs Meta approval)?
3. Admin without a phone: skip silently (proposed), or record FAILED `RECIPIENT_PHONE_MISSING`?
4. Does the 2026-11-04 decision waive ADR-042's Meta-terms validation gate, or only set the MVP direction?
5. Is it acceptable that admins and staff have no explicit WhatsApp opt-in in MVP?

## ADR-042 addendum (to append verbatim after approval)

> ### Addendum — 2026-11-04: Shared sender for MVP (owner decision)
>
> **Decision.**
> - For MVP, Randevu'N uses **one shared, platform-managed Meta WhatsApp sender** for all tenants.
> - It is configured from server-side environment secrets (`WHATSAPP_*`) and uses centrally managed, Meta-approved templates.
> - Tenant-connected senders and per-tenant sender resolution (the hybrid model above) are **deferred post-MVP**.
> - The architecture constraints in this ADR still apply when the hybrid model is picked up.
>
> **Recipients.** The shared sender delivers informational appointment messages to three groups:
> - the **customer**;
> - the **assigned staff member**;
> - the **TENANT_ADMIN** members of the same tenant.
>
> All of them are resolved on the server from the appointment's trusted tenant context, never from client input.
>
> **Event mapping for MVP.**
> - `APPOINTMENT_CREATED` → staff, customer and tenant admins.
> - `APPOINTMENT_CONFIRMED` / `APPOINTMENT_REJECTED` → customer.
>
> **Dedupe and idempotency.**
> - Recipients are deduplicated per profile, and internal recipients are also deduplicated by phone number.
> - Idempotency remains one `NotificationDelivery` row per `(tenantId, appointmentId, eventType, channel, recipientProfileId)`.
> - No schema change is required.
>
> **Still open / not approved by this addendum.**
> 1. The external validation gate above still applies before production use, unless the owner explicitly records a waiver. It requires evidence that Meta/provider terms permit multi-tenant shared sending.
> 2. Webhook status routing under the shared sender is unresolved. `WhatsAppIntegration` maps a phone-number ID to exactly one tenant, so status updates for other tenants' messages fail closed: there is no cross-tenant mutation, but also no DELIVERED/FAILED update. Fixing this changes the W11.6-approved routing and requires separate C3 review.
> 3. Recipient consent/opt-in and any new or salon-specific templates are out of MVP scope.
>
> Only SUPER_ADMIN controls sender policy. TENANT_ADMIN cannot select or change the sender.

## Report
`AGENTS.md` Required Report, then update `docs/SESSION_HANDOFF.md`.
