# W10 — MVP Application Integration & Real-Pilot Readiness

Status: ARCHITECT PLAN — HUMAN APPROVAL REQUIRED BEFORE BUILDER IMPLEMENTATION

Source of truth:
- Issue #54: W10: MVP application integration and real-pilot readiness
- docs/PROJECT_GOVERNANCE.md
- docs/AGENT_OFFICE_OS.md
- existing W01–W09 domain/application/persistence implementation
- .claude/agents/salon-saas-uiux.md
- .claude/skills/salon-saas-uiux/

## 1. Objective

Wire the existing secure W01–W09 foundation into a minimal operational MVP without changing approved domain semantics, booking concurrency guarantees, authentication/authorization architecture, tenant isolation, or RLS.

Acceptance journey:

Tenant Setup → Staff → Services → Working Hours → Public Vitrin → Customer Booking → Admin sees request → Staff/Admin decision → Completion → Customer History

## 2. Current architectural evidence

Existing foundations confirmed:
- tenant resolution and trusted TenantContext
- server authorization enforcement seam
- tenant-aware Prisma context and RLS
- staff provisioning
- service management
- working-hours management
- booking engine and appointment lifecycle
- calendar/CRM domain/persistence foundations
- public tenant/catalog/booking foundation
- notification service + WhatsApp provider boundary

Current application gap:
- user-facing pages/routes/server actions are not wired
- root page remains starter UI
- only WhatsApp webhook exists under src/app/api
- lifecycle notification invocation is not proven end-to-end

## 3. Implementation sequence

### W10.1 — Application request/auth boundary

Build the smallest reusable server boundary for protected application entry points.

Responsibilities:
1. establish server-side authenticated application identity
2. resolve trusted tenant context
3. enforce role/membership through existing authorization composition
4. pass only trusted identity + TenantContext into use cases
5. fail closed on missing auth, tenant, membership, or persistence failure

Do not create a second authorization policy.

Expected areas:
- server auth adapter usage
- tenant resolution usage
- server authorization enforcement usage
- protected Server Actions / Route Handlers

Security gate:
- no client tenantId/subjectId/profileId/role authority
- no global subject→Profile lookup
- no tenant inference from arbitrary form fields

### W10.2 — Admin shell + management workflows

Wire existing management application contracts to authenticated admin UI:
- staff
- services
- working hours

Required states:
- loading
- empty
- validation error
- conflict
- persistence failure
- success
- unauthorized

No new domain fields or business rules.

### W10.3 — Calendar + appointment operations

Wire admin calendar and appointment detail/actions to existing appointment/calendar contracts.

UI must represent only valid lifecycle transitions:
- PENDING → CONFIRMED / REJECTED / CANCELLED
- CONFIRMED → COMPLETED / CANCELLED
- terminal states remain terminal

The server remains authoritative.

Staff UI:
- staff-specific appointment view
- authorized PENDING decision flow
- no client-controlled staff authority

### W10.4 — Public vitrin

Create public tenant slug route using existing tenant-by-slug/public catalog contracts.

Show only public-safe active:
- tenant identity
- services
- staff
- working hours

Do not expose internal authorization or tenant-management data.

### W10.5 — Public booking

Wire public booking UI to the existing public booking/availability contract.

Flow:
1. choose service
2. choose staff when applicable
3. choose date/time
4. enter customer information
5. submit
6. show server-authoritative result

Explicit outcomes:
- invalid input
- slot unavailable
- invalid resource
- persistence failure
- success

Never claim a slot is guaranteed from client-side availability alone.

### W10.6 — Customer history / CRM

Wire customer card/history and relevant customer notes to existing tenant-safe contracts.

Ensure:
- customer identity remains tenant-scoped
- notes are never rendered across tenant boundaries
- history is read through trusted tenant context

### W10.7 — Notification event wiring

Connect lifecycle application boundaries to the existing NotificationService.

Required events:
- appointment created
- appointment confirmed
- appointment rejected

Do not change provider architecture.

W09 webhook status routing remains outside W10 unless the real-pilot acceptance explicitly requires it.

### W10.8 — Critical integration/E2E coverage

Cover the complete MVP journey plus security regressions.

Required regression scenarios:
- cross-tenant access
- missing tenant context
- unauthorized admin/staff action
- concurrent booking
- invalid appointment transition
- timezone conversion
- duration + buffer
- inactive/unavailable staff
- persistence failure
- notification idempotency
- public booking failure states

## 4. UI/UX Agent deliverables

Before Builder implementation of major screens, UI/UX Agent should produce:
- product UX map
- information architecture
- role/navigation matrix
- user journeys
- design principles/tokens
- component inventory
- screen specifications
- appointment UX contract
- booking UX contract
- responsive strategy
- accessibility contract
- UX copy guide
- design QA gates
- open questions

Unresolved domain/backend/security contracts are BLOCKED, not guessed.

## 5. Expected implementation areas

Likely application/UI areas:
- src/app/
- src/components/
- protected Server Actions / Route Handlers
- application composition adapters where needed
- integration tests / E2E tests
- UI/UX design artifacts

Expected non-changes:
- Prisma schema unless a separately approved gap is discovered
- RLS policy semantics
- TenantContext semantics
- authorization policy semantics
- appointment state machine
- booking conflict algorithm
- external provider architecture

Exact files must be confirmed from current repository structure before Builder changes them.

## 6. Test strategy

Minimum gates:
- targeted unit/integration tests for new application boundaries
- critical MVP flow integration/E2E tests
- security regression tests
- npm run lint
- npm run typecheck
- npm test
- npm run build
- CI green before merge

UI QA:
- 320 / 390 / 414 / 768 / 1024 / 1280+
- keyboard/focus
- interaction states
- loading/empty/error/success
- accessibility
- visual hierarchy
- anti-slop review

## 7. Security and tenant impact

Impact: HIGH.

Protected flow must remain:

Server Auth → trusted TenantContext → authorization → tenant-aware use case → tenant-scoped persistence/RLS

Public booking remains intentionally unauthenticated, but resource and availability validation remains server-side.

No client-provided tenant identifier is authoritative.

## 8. Migration impact

Expected: none for the planned W10 wiring.

If implementation discovers a required schema/migration change, STOP and escalate because W10 is C3 and the change requires explicit approval.

## 9. Scope exclusions

No:
- payments
- subscriptions/billing automation
- loyalty
- inventory
- payroll
- accounting
- native mobile
- advanced AI
- multi-location
- unrelated redesign
- autonomous production deployment
- W09 webhook tenant-routing redesign unless separately approved

## 10. Risks

1. Existing application contracts may have naming/location differences from the initial audit; Builder must inspect current source before binding UI.
2. Supabase Auth server integration must preserve the established identity boundary.
3. Public booking and notification wiring cross important trust boundaries.
4. UI may expose actions that are visually available but server-denied; application responses must remain authoritative.
5. E2E environment may require explicit test infrastructure decisions; do not silently add external services.

## 11. Handoff to Builder

Builder may begin only after explicit human approval of this C3 plan.

Builder handoff must include:
- this plan
- approved UI/UX artifacts
- exact source files after final inspection
- acceptance criteria
- test matrix
- security/tenant constraints
- do-not-change list

## 12. Definition of Done

W10 is complete only when:
- core journey is operational
- role boundaries are enforced server-side
- tenant isolation remains intact
- booking concurrency remains intact
- critical integration/E2E coverage exists
- UI/UX QA passes
- lint/typecheck/test/build pass
- CI is green
- migration impact is recorded
- deviations and remaining risks are documented
- human merge approval is obtained
