# W11 — Pilot Readiness & Production Hardening

Status: ARCHITECT PLAN — HUMAN APPROVAL REQUIRED BEFORE BUILDER IMPLEMENTATION

## 1. Objective

Convert the completed W10 application wiring into a pilot-ready product while preserving the established authentication, tenant isolation, RLS, booking concurrency, appointment state machine, and provider-neutral notification architecture.

W11 also establishes the approved PWA-first mobile strategy so the first physical-product milestone can be validated with a real salon using the web/PWA rather than a native mobile application.

## 2. Baseline

Validated baseline:
- W01–W10 complete
- W10 final merge commit: `a1d4328ae833279fb601db3765cba847f24e5f03`
- main CI #171 previously validated green
- current product flow: Tenant → Staff → Services → Working Hours → Public Vitrin → Customer Booking → Admin Calendar → Staff Decision → Appointment Lifecycle → Customer History → WhatsApp boundary

W10 completion is not production readiness. Real Supabase, real Meta WhatsApp, pilot security validation, UX hardening, PWA/Web Push, and production preparation remain.

## 3. Governing constraints

- Server flow remains: Authenticate → trusted tenant context → membership/role authorization → application operation → tenant-aware persistence → PostgreSQL RLS.
- Client tenantId, subjectId, profileId, and role are never authoritative.
- Missing auth, tenant, membership, or role fails closed.
- RLS cannot be weakened.
- Appointment state-machine semantics cannot change without C3 review.
- Unplanned migrations are STOP + review.
- No autonomous production deployment.
- Never delete tests to obtain green CI.
- MVP scope cannot expand silently.
- Real provider behavior must not be represented as validated until tested against the real provider.

## 4. Execution sequence

### W11.1 — Post-W10 architecture audit

Audit, in order:
1. current main state and CI
2. Prisma schema/migrations
3. Supabase Auth
4. tenant binding
5. membership/role authorization
6. RLS
7. booking engine
8. public booking
9. notification service/runtime
10. UI/UX contracts
11. environment/secret boundaries
12. open risks

Output: PASS / FAIL / BLOCKED with evidence and deviations.

Do not implement fixes while the audit is still identifying architectural uncertainty.

### W11.2 — Public booking UX hardening

Replace the current minimal booking experience with:

Service → Staff → Availability → Date/Time → Customer → Confirmation

Requirements:
- catalog-driven service/staff selection
- server-authoritative availability
- tenant timezone clarity
- unavailable/conflict/error states
- no raw internal IDs presented as product UX
- confirmation state must reflect the actual server result

Do not change booking-domain semantics.

Known contract improvement to evaluate: `createPublicBooking` should return the created appointment ID directly rather than relying on a post-create lookup.

### W11.3 — CRM list/search

Extend the current customer-history foundation to:

Customer List → Search → Customer Detail → Appointment History → Notes

All reads/writes remain tenant-scoped and server-authorized.

### W11.4 — Real Supabase pilot validation

Against a production-like Supabase project validate:
- owner authentication
- staff invitation/provisioning
- app_metadata tenant binding
- TenantContext resolution
- TenantMembership authorization
- RLS isolation
- inactive staff behavior
- failure/rollback boundaries

No secrets in source or client bundle.

### W11.5 — Real Meta WhatsApp pilot validation

Validate with the real Meta WhatsApp Cloud API:
- configured templates
- successful delivery
- provider response persistence
- NotificationDelivery behavior
- provider failure behavior
- duplicate/idempotency behavior
- staff/customer recipient mapping

Do not claim production delivery readiness from mock-provider tests alone.

### W11.6 — WhatsApp webhook tenant routing

C3 architectural decision before implementation.

Target routing concept:

Meta phone_number_id → tenant-scoped WhatsAppIntegration → tenantId → NotificationDelivery → providerMessageId → delivery status

Likely model candidate:

```
WhatsAppIntegration {
  id
  tenantId
  provider
  phoneNumberId
  status
}
```

This is a design candidate, not an approved schema. Human approval is required before migration/implementation.

Provider message ID uniqueness/indexing and the exact supported delivery-status enum must be reviewed. Do not invent a READ state if the current domain model does not support it.

### W11.7 — Two-tenant security regression

Create an explicit Tenant A / Tenant B regression suite covering:
- records
- appointments
- customers
- notes
- notifications
- staff actions
- public booking resource boundaries
- direct identifier manipulation
- missing tenant context
- inactive membership/staff

Acceptance: Tenant A cannot read, mutate, or infer Tenant B data through supported application surfaces.

### W11.10 — PWA foundation

Build only after the PWA ADR is accepted and the audit does not reveal blocking architectural issues.

Scope:
- responsive mobile UX hardening
- manifest
- installability metadata
- app icons/assets
- standalone app experience
- service-worker foundation
- mobile navigation/interaction QA
- 320 / 390 / 414 / 768 / 1024 / 1280+ responsive checks

No offline business-domain mutation is implied by this phase.

### W11.11 — Web Push

C3 architecture review is required before persistence or provider implementation.

Scope:
- approved push-subscription model/boundary
- secure subscription persistence
- explicit user-initiated permission UX
- WebPushProvider behind NotificationService
- staff booking notification routing
- multi-device handling
- invalid/revoked subscription cleanup
- delivery/error handling
- staff deactivation behavior
- tenant/profile authorization and RLS regression

Notification failure must not mutate appointment lifecycle state.

### W11.8 — Pilot acceptance suite

Run the full physical-product journey:

Tenant → Owner → Staff → Service → Working Hours → Public Vitrin → Customer Booking → Admin Calendar → Staff Decision → Staff Notification → Customer WhatsApp → Customer History

Pilot acceptance requires real-device PWA use by staff and real external integrations where the acceptance criterion depends on them.

### W11.9 — Production readiness

Before any production deployment:
- CI green
- migration review
- RLS/security regression green
- production-like Supabase validation
- Meta production configuration validation
- webhook routing validated
- secrets/config reviewed
- staging validation
- pilot acceptance complete
- explicit human production approval

Deployment sequence:

Deployment Plan → Human Approval → Environment Configuration → Migration Verification → Staging → Pilot Acceptance → Human Production Approval → Production Deployment

## 5. PWA-first product decision

Native iOS/Android is not an MVP requirement.

The approved distribution stack is:

Responsive Web + PWA + Web Push + WhatsApp

Native becomes a conditional future platform expansion only if a validated requirement demonstrates that PWA cannot meet the required capability or reliability.

## 6. Security and tenant impact

Impact: HIGH.

W11 must preserve:

Server Auth → trusted TenantContext → role/membership authorization → tenant-aware application operation → tenant-scoped persistence → RLS

Push subscriptions and WhatsApp integrations are tenant-sensitive infrastructure data and must never become a client-controlled authorization path.

## 7. Migration policy

Expected migration impact:
- W11.1–W11.5: no planned schema migration unless an explicitly approved gap is discovered
- W11.6: possible WhatsAppIntegration migration, C3 approval required
- W11.11: possible PushSubscription migration, C3 approval required

Any migration not already covered by an approved plan is STOP + review.

## 8. Definition of Done

W11 is complete only when:
- public booking UX is operational and server-authoritative
- CRM list/search is tenant-safe
- real Supabase pilot validation passes
- real Meta WhatsApp validation passes
- webhook routing is architecturally approved and validated if required for pilot
- two-tenant security regression passes
- PWA is installable and usable by pilot staff
- Web Push works through the approved provider boundary if included in pilot acceptance
- full pilot acceptance passes with evidence
- lint/typecheck/test/build and CI are green
- migration/security impacts are recorded
- remaining risks are documented
- human approval is obtained for production deployment

## 9. Do-not-change list

Without separate C3 approval, W11 Builder work must not change:
- tenant model
- trusted identity source
- authorization policy composition
- RLS semantics
- appointment state machine
- booking conflict algorithm
- provider-neutral NotificationService boundary
- production deployment authority
- MVP scope

## 10. Handoff

Builder receives:
- this W11 plan
- ADR-043 PWA-first strategy
- approved UI/UX artifacts
- exact source-file inspection results
- acceptance matrix
- security/tenant constraints
- migration constraints
- explicit do-not-change list

Builder may begin only after human approval of the relevant C3 plan.
