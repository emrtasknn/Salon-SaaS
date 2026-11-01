# P9 — MVP Closure Gate

Status: **OPEN / NOT CLOSED**. This document defines the product and engineering evidence required to declare the MVP complete. It does not authorize production deployment or commercial launch.

## Purpose

Close the approved MVP scope only after the real salon workflow is usable, security and data integrity are demonstrated, operational risks are accepted, and the product owner explicitly signs off.

P9 is not a substitute for P7 pilot acceptance or P8 production readiness. P7 validates the pilot journey; P8 validates release readiness; P9 records the final MVP scope, evidence, known limitations, and closure decision.

## Closure principles

- No silent feature expansion.
- Security and data integrity take precedence over visual polish.
- Do not close an item based on a mock when real integration/device evidence is required.
- Do not repeat already accepted historical tests unless a relevant code/configuration regression exists.
- Do not erase or reset Pilot records to make a checklist pass.
- Do not automatically retry ambiguous `UNKNOWN` notification outcomes.
- No production deployment or public commercial launch without the separate required approval.

## Required prerequisite decisions

- [ ] P7 pilot acceptance is explicitly CLOSED with evidence.
- [ ] P8 production readiness review is READY, with residual risks accepted.
- [ ] MVP customer booking model is explicitly confirmed (guest booking, mandatory account, or optional account). Existing implementation behavior is not itself a product decision.
- [ ] MVP notification channel scope is confirmed (WhatsApp-only, WhatsApp + Web Push, or other explicitly approved scope).
- [ ] Shared platform WhatsApp sender is either validated as permitted for the intended multi-tenant model or excluded from production scope pending a separate architecture decision.
- [ ] Any feature intentionally deferred from MVP is listed with rationale and post-MVP owner/priority.

## MVP functional acceptance

### Tenant and salon setup

- [ ] Tenant provisioning and slug resolution work through authorized platform flow.
- [ ] Tenant admin can manage only their tenant's salon identity and settings.
- [ ] Tenant timezone is explicit and respected.
- [ ] Platform-only tenant creation/policy actions are not exposed to tenant admins.

### Staff and services

- [ ] Tenant admin can create/update/activate/deactivate staff.
- [ ] Staff identity is bound to the trusted tenant and correct role.
- [ ] Tenant admin can create/update/activate/deactivate services and duration/buffer.
- [ ] Working hours and closed days constrain public availability.
- [ ] Staff inactive state blocks unauthorized staff operations.

### Public storefront and booking

- [ ] Public storefront resolves the tenant from a trusted slug/domain boundary.
- [ ] Public catalog exposes only that tenant's active services and eligible staff.
- [ ] Approved booking identity model is implemented and documented.
- [ ] Availability is calculated server-side using tenant timezone, staff, service duration/buffer, working hours, and existing appointments.
- [ ] Final booking creation transactionally re-checks conflicts.
- [ ] Invalid, unavailable, cross-tenant, and conflicting resource IDs fail closed.
- [ ] Booking result accurately reflects persisted appointment state.
- [ ] Customer identity/contact details are associated with the correct tenant and appointment.
- [ ] Public booking abuse/rate controls are in place at the approved MVP level.

### Appointment lifecycle and calendar

- [ ] PENDING → CONFIRMED/REJECTED works only for authorized staff/admin actions.
- [ ] Invalid lifecycle transitions are rejected.
- [ ] Notification provider failure does not roll back or falsify appointment lifecycle.
- [ ] Admin calendar displays correct staff, customer, service, time, and status.
- [ ] Staff sees and acts only on authorized appointments.
- [ ] Customer history reflects the appointment lifecycle.

### CRM

- [ ] Customer list/search/detail behavior required by MVP is present.
- [ ] Appointment history is tenant-scoped.
- [ ] Customer notes are tenant-scoped and role-authorized.
- [ ] Direct-ID access cannot retrieve another tenant's customer/history/note.

### Notifications

- [ ] Recipient mapping for each approved event is documented.
- [ ] CREATED/CONFIRMED/REJECTED behavior matches the approved MVP scope.
- [ ] Idempotency prevents duplicate successful sends for the same tenant/event/recipient.
- [ ] Definite provider rejection and ambiguous outcome are distinguished.
- [ ] UNKNOWN is not automatically retried; reconciliation procedure is documented.
- [ ] Webhook status updates are authenticated, tenant-routed, and monotonic where required.
- [ ] Customer consent and business identity are appropriate for each notification.
- [ ] No unresolved shared-sender permission assumption is treated as approved.

### Mobile/PWA

- [ ] Staff core workflow is usable in supported mobile browsers.
- [ ] PWA installation/standalone launch is accepted on target device(s).
- [ ] Responsive layouts and navigation are accepted.
- [ ] Push capability is included only if explicitly part of MVP scope; otherwise it is recorded as deferred.
- [ ] Offline business mutations are not implied unless separately designed and approved.

## Security and reliability closure

- [ ] P6/W11.7 two-tenant regression remains green.
- [ ] W11.6 webhook tenant routing and real database security posture are verified.
- [ ] RLS/FORCE RLS, transaction-local tenant context, and least-privilege DB access are validated.
- [ ] Auth/authorization failure paths fail closed.
- [ ] Secrets and PII are not exposed in client bundles/logs/evidence.
- [ ] Database migration and backup/restore evidence is accepted.
- [ ] Critical/high severity defects are resolved or explicitly accepted with mitigation.
- [ ] Observability and operator runbooks are adequate for the agreed MVP scope.

## Release artifact and documentation

- [ ] Main contains only reviewed/approved changes.
- [ ] Required GitHub branch protections and CI checks are active.
- [ ] Release commit/tag is identified.
- [ ] CI, lint, typecheck, integration tests, and build are green for the release commit.
- [ ] Environment/configuration inventory is complete without exposing secret values.
- [ ] Operator runbook, known limitations, support path, and rollback notes are published.
- [ ] Product scope and deferred items are documented.
- [ ] Evidence register links every acceptance claim to its source and provenance.

## Known deferred/out-of-scope candidates (must be explicitly accepted, not assumed)

- Subscription billing and automated payments.
- Advanced CRM/segmentation/loyalty.
- Inventory, payroll, accounting, and multi-branch enterprise operations.
- Native iOS/Android applications.
- AI/advanced analytics.
- Advanced campaign/reminder scheduling and template customization.
- Web Push if not selected as a required MVP capability.
- Production Meta shared-sender model until permission and operational requirements are validated.

This list is a planning aid. The owner must confirm which items are truly outside the approved MVP scope.

## P9 closure decision

P9 may be CLOSED only when:

1. P7 is explicitly CLOSED.
2. P8 readiness is explicitly accepted.
3. Every required MVP functional/security criterion has evidence.
4. Product decisions and deferred scope are explicit.
5. No unresolved release-blocking defect or unaccepted critical risk remains.
6. The owner records an explicit MVP closure decision.

**MVP CLOSED does not automatically authorize production deployment, public marketing, paid subscriptions, or commercial expansion.** Those require their own approvals and readiness checks.
