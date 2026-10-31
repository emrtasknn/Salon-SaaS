# W11 — Pilot Readiness & Production Hardening

Status: IN PROGRESS — progress checkpoint updated 2026-10-25. This document records merged work and remaining gates; it is not a production-readiness approval.

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

## 2A. Progress checkpoint — 2026-10-25

### Merged implementation evidence

- **PR #97 (merged):** corrected the tenant-aware setup/cleanup for forced-RLS integration fixtures and expanded RLS coverage to include WhatsAppIntegration. GitHub Actions ran on isolated PostgreSQL 17; 52 test files and 241 tests passed, including all 5 RLS integration tests. This validates that CI suite, not the full real-pilot two-tenant acceptance journey.
- **PR #98 (merged):** staff provisioning binds the newly created Auth user to the trusted tenant using the existing server-side binding adapter; binding/persistence failure paths fail closed and compensate/rollback as covered by automated tests. The existing Pilot Staff account still requires a separate controlled repair; no automatic real-account repair is implied.
- **PR #99 (merged):** admin calendar entries show staff/customer/service display names and admin management links to the calendar. Local validation reported typecheck passed, 237 tests passed, 5 RLS integration tests skipped, and diff check passed. The calendar UI and appointment completion action were manually exercised in the local browser.

### W11 status — do not infer completion from merged PRs alone

**W11.4 COMPLETE / CLOSED (2026-10-31):** The project owner explicitly confirms that every test and exit criterion defined within W11.4 has passed. The acceptance packet records the evidence classifications and the two-tenant validation; W11.4 is closed. This does not close the separate W11.7 workstream or wider W11 pilot/production gates.

| Workstream | Current status | Remaining gate |
|---|---|---|
| W11.1 Architecture audit | Findings and guardrails documented in the existing W11/architecture documents | Reconfirm current main/CI and resolve any audit blockers before scope-sensitive work |
| W11.2 Public booking UX | Existing booking path is operational enough for the documented real pilot booking; full UX-hardening scope is not declared complete here | Catalog-driven flow, timezone clarity, conflict/error states, and server-result fidelity need explicit acceptance evidence |
| W11.3 CRM list/search | Existing customer history/notes foundation is present | Full list → search → detail → history → notes acceptance remains to be verified |
| W11.4 Real Supabase | **COMPLETE / CLOSED — all acceptance tests PASS** | Owner explicitly confirmed all W11.4 tests and exit criteria passed; evidence classifications are recorded in `docs/W11.4_SUPABASE_PILOT_ACCEPTANCE.md`. Do not repeat completed tests absent a new regression or defect. |
| W11.5 Real Meta WhatsApp | Local real-Meta `APPOINTMENT_CREATED` smoke test passed for staff + customer; both delivery records were `SENT` with provider IDs. Diagnostic changes remain local/unmerged. | Reconcile local changes with GitHub before commit; still validate failure behavior, duplicate/idempotency behavior, CONFIRMED/REJECTED events, and recipient/tenant boundaries. Do not infer production readiness. |
| W11.6 Webhook routing | OPEN; C3 decision required before implementation/migration | Human approval of tenant-scoped integration and status mapping; READ remains non-mutating |
| W11.7 Two-tenant regression | PR #97's RLS integration suite is green in CI; full W11.7 application-level acceptance is not claimed complete | Verify the complete Tenant A/B matrix across application surfaces, direct IDs, staff actions, public booking, and missing/inactive context |
| W11.10 PWA | Planned; completion not established by these PRs | Complete approved PWA foundation and responsive/mobile QA |
| W11.11 Web Push | Architecture-gated planned work | C3 approval before persistence/routing implementation, then tenant/profile/RLS regression |
| W11.8 Pilot acceptance | BLOCKED until prerequisites and real-device/provider evidence are available | Run the full acceptance matrix; BLOCKED scenarios cannot be marked PASS |
| W11.9 Production readiness | NOT APPROVED | All production gates plus explicit human production approval |

### Local real-provider evidence — 2026-10-25 (not merged)

A controlled local booking triggered two real Meta WhatsApp messages for `APPOINTMENT_CREATED` (staff and customer). Both were received on the pilot device; the two matching `NotificationDelivery` rows were `SENT`, each had a provider message ID, `attemptCount = 1`, and no error code. Two earlier records remain `UNKNOWN` with `PROVIDER_OUTCOME_UNKNOWN` and were not modified. Local diagnostic changes passed `npm run typecheck`, the two targeted Vitest files (6/6 and 8/8), and `npm run whatsapp:preflight` (5/5). These results have not yet been reconciled to the local working tree and committed/pushed; this checkpoint is evidence of a local test, not a merged code change. The test covers `APPOINTMENT_CREATED` only and does not close W11.5's failure/idempotency/CONFIRMED/REJECTED scenarios, W11.4, W11.6, W11.7, pilot acceptance, or production readiness.

The local PR #99 test run skipped the five RLS integration tests; use the successful CI run from PR #97 as the relevant evidence for that suite. The PR #97 CI result is database integration evidence; the owner-reported real-environment two-tenant manual validation is separately recorded under W11.4. Neither result substitutes for real Meta delivery validation.



## 2B. Progress checkpoint — 2026-10-31

This checkpoint supersedes earlier W11.5/W11.7 status notes where they conflict, while preserving the historical evidence and its original classification.

### W11.5 — Real Meta WhatsApp

**Status: PARTIAL PASS / OPEN — code hardening and automated coverage are progressing; external pilot exit criteria remain.**

Merged implementation:
- PR #112 hardens provider message-ID validation, non-sensitive error handling, and prevents automatic resend of `UNKNOWN` deliveries.
- PR #115 adds application-service coverage for the `APPOINTMENT_CONFIRMED` customer notification and reconciles the W11.5 pilot plan.
- Existing automated tests cover CREATED staff/customer recipient mapping, CONFIRMED and REJECTED customer routing, duplicate/already-sent behavior, ambiguous outcomes, and the non-retryable UNKNOWN state.

Owner-reported real-device evidence:
- The owner reports successful real Meta delivery for the displayed CREATED and CONFIRMED customer scenarios; the supplied conversation screenshot corroborates receipt/content.
- The earlier controlled CREATED smoke test recorded staff and customer delivery records as SENT with provider IDs and attemptCount = 1.
- These are owner-reported/local pilot evidence, not production approval or proof of every W11.5 exit criterion.

Current code hardening under review:
- PR #120 distinguishes definite Meta 4xx rejection (except 408) and local missing-template configuration from ambiguous outcomes.
- Definite rejections are persisted as FAILED; network errors, HTTP 408/5xx, and missing provider message IDs remain UNKNOWN.
- UNKNOWN remains non-retryable automatically.
- A PostgreSQL-backed notification integration test verifies PENDING/SENT duplicate suppression, UNKNOWN non-retryability, and explicit FAILED re-claim behavior with persisted attempt counts.

Still OPEN and requiring isolated external evidence:
- Real Meta APPOINTMENT_REJECTED customer delivery.
- Controlled real-provider failure behavior and resulting FAILED/UNKNOWN classification.
- Real repeated-event/idempotency behavior.
- Confirmation that the shared sender is permitted under applicable Meta/provider terms.
- Secret/configuration boundary review in the isolated pilot environment.

No real WhatsApp message is sent by CI. Do not infer W11.5 completion from unit tests or CI. Do not automatically retry UNKNOWN outcomes.

### W11.6 — WhatsApp webhook tenant routing

**Status: OPEN — C3 decision required before implementation.**

The proposed tenant-scoped WhatsAppIntegration routing and status mapping remain subject to explicit human approval. READ remains non-mutating; providerMessageId remains non-globally-unique. No W11.6 schema migration or webhook status persistence is authorized by the W11.5 work.

### W11.7 — Two-tenant security regression

**Status: IN PROGRESS — significant RLS and application-level coverage merged; public-booking integration coverage is under review.**

Merged:
- PR #116 adds reciprocal Tenant A/B RLS read and direct-ID mutation coverage.
- PR #118 adds reciprocal CRM customer search/calendar isolation, cross-tenant customer-note mutation denial, and staff appointment authorization regression coverage.

Under review:
- PR #119 adds PostgreSQL-backed public-booking and public-availability resource-boundary tests in both tenant directions, direct-ID RLS mutation checks across all nine tenant-owned tables, Tenant A/B integration coverage for service/staff/working-hours management repositories, and tenant-scoped notification recipient resolution.

The broader W11.7 matrix remains open until all supported application surfaces and exit criteria have been audited and evidenced. Do not infer W11.7 closure from PR #119 alone.

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
