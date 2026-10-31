# Salon SaaS — Product Roadmap

## Purpose

This document is the durable product roadmap for the Salon SaaS MVP and post-MVP journey. It separates product phases from implementation issues and keeps the approved critical path visible.

The live repository is the implementation source of truth. This roadmap records product scope and sequencing; it does not replace architecture plans, ADRs, or GitHub issues.

## Product Journey

```
FOUNDATION
  ↓
MVP PRODUCT
  ↓
REAL SALON PILOT
  ↓
MVP v1
  ↓
PRODUCTIZATION
  ↓
COMMERCIAL SaaS
  ↓
GROWTH
  ↓
INTELLIGENCE
```

## Foundation

The foundation establishes the security and tenancy boundary required before product-domain expansion:

- Governance
- Agent Office
- Authentication
- Tenant isolation
- Authorization
- Prisma
- PostgreSQL
- Row-Level Security (RLS)

The current project has substantially completed this foundation and has completed the real Supabase pilot work documented in the repository.

## Current Implementation Checkpoint — 2026-10-25

This checkpoint records merged implementation and validation evidence. It does not override the detailed W11 plans or imply pilot/production readiness.

### Recently completed and merged

### Local validation checkpoint — 2026-10-25 (not yet merged)

- **W11.5 outbound smoke test:** two real WhatsApp messages for one new `APPOINTMENT_CREATED` booking were received on the pilot device (staff and customer templates). The two matching delivery records were `SENT`, each had a provider message ID, `attemptCount = 1`, and no error code. Earlier `UNKNOWN` deliveries were left unchanged. This is local test evidence; the corresponding diagnostic code changes remain to be reconciled with the local working tree and reviewed before committing. It does not complete webhook status persistence, full W11.5 negative/idempotency scenarios, W11.4, W11.7, pilot acceptance, or production readiness.

- **PR #97 — RLS integration test harness:** fixed tenant-context-aware fixture setup/cleanup and expanded WhatsAppIntegration coverage for tenant read isolation, missing tenant context, and cross-tenant mutation. GitHub Actions validated on isolated PostgreSQL 17: 52 test files passed and 241 tests passed, including all 5 RLS integration tests. This is CI database evidence. At the time of PR #97 it did not establish the manual real-environment scenario; the owner subsequently confirmed repeated two-tenant manual isolation testing, now recorded as W11.4 MANUAL PASS below.
- **PR #98 — staff Auth/tenant binding:** staff provisioning now binds the new Auth user to the trusted tenant through the existing server-side adapter, fails closed and compensates when binding fails, and rolls back a new binding when staff persistence conflicts. This does not automatically repair the existing Pilot Staff account; that remains a separate controlled follow-up.
- **PR #99 — admin calendar display names:** the admin calendar now displays staff, customer, and service names instead of raw IDs, and admin management links to the calendar. Local typecheck and test evidence was reported; 237 tests passed and 5 RLS integration tests were skipped in that local run. The calendar workflow was manually exercised in the local browser, including completing an appointment.

### Remaining W11 gates

- **W11.4 — documentation correction (2026-10-31):** the project owner confirmed that two real tenants already exist in the database, with distinct salon details and separate staff. They have repeatedly manually verified reciprocal isolation: Tenant A cannot access Tenant B's data, and Tenant B cannot access Tenant A's data. The two-tenant isolation scenario is recorded as **MANUAL PASS** in `docs/W11.4_SUPABASE_PILOT_ACCEPTANCE.md`; the former “second tenant unavailable” blocker is stale and closed. Do not ask the owner to recreate tenants or repeat this same test. The specifically scoped authenticated cross-tenant public-booking edge case and the broader W11.7 matrix are not inferred from this result unless separately evidenced.
- **W11.5:** a local real-Meta test has now confirmed `APPOINTMENT_CREATED` messages for staff and customer on the pilot device; both corresponding `NotificationDelivery` records were `SENT`, had provider message IDs, and had `attemptCount = 1`. This is evidence for the CREATED outbound path only, not completion of all W11.5 exit criteria. The diagnostic changes and this local test evidence have not yet been reconciled/committed from the local working tree to GitHub main. Still verify failure behavior, idempotency/duplicate behavior, CONFIRMED/REJECTED events, and recipient/tenant boundaries. Do not treat the shared sender as production-approved until applicable Meta/provider terms are validated; reconcile the hybrid account policy with ADR-042 before implementation.
- **W11.6:** webhook status persistence remains gated on explicit C3 approval of tenant routing. Do not generate/apply its migration before approval; READ remains non-mutating and providerMessageId must not become globally unique without a separate decision.
- **W11.7:** PR #97 improves and validates the database/RLS integration suite, but the full application-level two-tenant security regression acceptance has not been declared complete.
- **W11.10 / W11.11:** PWA foundation and Web Push remain planned work subject to their documented architecture gates.
- **W11.8:** end-to-end pilot acceptance remains blocked by the mandatory external prerequisites and real-device evidence.
- **W11.9:** production readiness/deployment is not approved; all listed gates and explicit human approval remain mandatory.

## MVP Product Critical Path

```
Tenant / Salon Management
  ↓
Staff Management
  ↓
Service Management
  ↓
Working Hours
  ↓
Booking Engine
  ↓
Appointment Lifecycle
  ↓
Admin Calendar
  ↓
Customer CRM
  ↓
Public Vitrin
  ↓
Customer Booking
  ↓
Real Salon Pilot
  ↓
MVP v1
```

### Phase A — Tenant / Salon Management

Goal:

> A tenant can exist as a usable salon account.

Scope:
- tenant creation/use case
- tenant slug
- salon basic information
- timezone
- basic settings
- tenant-safe persistence
- server-side authorization

Phase boundary:
- Tenant provisioning and salon identity are usable and protected.
- Tenant creation must not become a tenant-admin capability unless separately approved.
- Existing tenant isolation and authorization guarantees remain intact.

See: `phases/PHASE_A_TENANT_SALON_MANAGEMENT.md`

### Phase B — Staff Management

Goal:

> A salon can define who provides services.

Scope:
- create/update staff
- activate/deactivate
- tenant relationship
- role handling through existing authorization
- schedule boundary

See: `phases/PHASE_B_STAFF_MANAGEMENT.md`

### Phase C — Service Management

Goal:

> A salon can define what customers can book.

Scope:
- create/update service
- active/inactive
- duration
- buffer
- price only if confirmed by approved product requirements
- tenant ownership
- staff/service association if required

See: `phases/PHASE_C_SERVICE_MANAGEMENT.md`

### Phase D — Working Hours

Goal:

> The system knows when booking is possible.

Scope:
- weekly hours
- closed days
- timezone-aware boundaries
- staff-specific schedule only if required by approved design

Do not introduce holiday/exception complexity without separate approval.

See: `phases/PHASE_D_WORKING_HOURS.md`

## Later MVP Product Milestones

After Phase D, the roadmap continues with:

1. Booking Engine
2. Appointment Lifecycle
3. Admin Calendar
4. Customer CRM
5. Public Vitrin
6. Customer Booking
7. Real Salon Pilot
8. MVP v1

### Booking Engine

Highest-risk product logic.

Required inputs include tenant, service, staff, working hours, existing appointments, duration, buffer, and timezone.

Core invariant:

> A final booking must be transactionally re-checked before creation.

Concurrency, cross-tenant isolation, timezone handling, duration + buffer, unavailable resources, and failure behavior are acceptance concerns.

### Appointment Lifecycle

Explicit state transitions are required. The approved MVP state model includes:

```
PENDING → CONFIRMED → COMPLETED
PENDING → CANCELLED
CONFIRMED → CANCELLED
```

Invalid transitions must be rejected.

### Admin Calendar

MVP scope:
- daily view
- weekly view
- staff columns/rows
- appointment blocks
- status
- customer
- service
- time
- basic appointment actions

### Customer CRM

Minimum:
- identity
- contact
- appointment history
- notes
- basic spending/history if approved

Do not build a full CRM suite for MVP.

### Public Vitrin

Dynamic tenant slug with:
- salon name
- basic information
- services
- staff where appropriate
- portfolio
- before/after
- working information
- reviews/rating
- booking CTA
- WhatsApp CTA where appropriate

Public pages must use trusted tenant resolution.

### Customer Booking

Target flow:

```
Public Salon
→ Service
→ Staff / Any Available
→ Date
→ Available Slots
→ Customer Information
→ Create Appointment
→ PENDING
```

The server owns tenant resolution, availability calculation, transactional re-check, persistence, and result reporting.

### Real Salon Pilot

The real pilot validates the complete operational journey before MVP v1.

Target flow:

```
Salon setup
→ Staff
→ Services
→ Working hours
→ Public page
→ Customer booking
→ Admin receives booking
→ Confirm
→ Complete
→ Customer history
```

The pilot must also exercise security and correctness boundaries such as cross-tenant access, missing/wrong tenant context, concurrent booking, cancellation, invalid state transitions, timezone boundaries, duration + buffer, closed days, staff availability, and DB failure.

## MVP v1 Exit

MVP v1 is reached only after the real-salon journey is usable and the critical security/correctness requirements remain intact.

## Post-MVP Roadmap

### Productization
- onboarding improvements
- mobile UX
- calendar UX
- customer UX
- notification improvements
- configurable WhatsApp appointment reminders (business-configurable timing, rescheduling/cancellation handling, idempotency, and visible delivery status)
- business-customizable WhatsApp message templates, dynamic placeholders, preview/testing, and Meta template approval/status lifecycle
- SMS
- review requests
- operational polish
- real-user bug fixing

### WhatsApp product direction — hybrid model agreed; implementation requires architecture approval

- **Product direction:** support a hybrid model with a platform-managed Randevu'N sender and, when permitted, a WhatsApp Business account connected by an individual salon. Do not hard-code the system to a single sender mode.
- **MVP starting point:** prefer the platform-managed Randevu'N account and centrally managed, Meta-approved templates so salons do not have to bring their own WhatsApp Business account at launch. This is conditional on confirming that the proposed multi-tenant sending model is permitted under the applicable Meta/provider terms. If it cannot be validated, do not treat shared sending as production-approved; return to architecture review before selecting the launch fallback.
- **Platform policy — SUPER_ADMIN only:** SUPER_ADMIN controls which sender modes are allowed, the platform default, and whether a tenant may use/connect its own account. Tenant admins must not be able to change sender mode or platform policy.
- **Tenant account connection — TENANT_ADMIN within permission:** if SUPER_ADMIN enables tenant-owned accounts for a tenant, that tenant's TENANT_ADMIN may complete/manage only that tenant's account connection and view its connection status. They cannot change the platform's sender policy or access another tenant's integration.
- **Server-side sender resolution:** resolve the effective sender mode and account from trusted server-side platform policy and tenant configuration. Never trust client-supplied sender mode, tenant IDs, recipient numbers, account IDs, or template identifiers for authorization. Fail closed if the configured sender/account/template is missing, disabled, unapproved, or inconsistent; do not silently fall back to another tenant's account or configuration.
- **Initial template scope:** centrally managed, Meta-approved templates with dynamic appointment and tenant-specific parameters. Resolve recipients and message parameters server-side from trusted appointment, tenant, and profile data. Clearly identify the relevant salon and Randevu'N's role in the notification.
- **Tenant isolation:** keep each tenant's notification configuration, template mapping, connected-account metadata, delivery records, and idempotency keys tenant-scoped. Shared platform credentials remain infrastructure secrets and must never be exposed to clients or stored in source control. A template mapping or connected account belonging to one tenant must never be selected for another tenant.
- **Post-MVP customization:** allow salon-specific message content and template submission/review/approval lifecycle after the core pilot. Track approval/enabled status and do not send a template that is not approved and enabled for the applicable sender/account.
- **Reminder scheduling:** configurable reminder timing, visible delivery status, and reminder lifecycle are productization work, separate from the initial appointment-event notification flow. Appointment changes/cancellations must safely reschedule or suppress pending reminders.
- **Architecture and implementation gates:** this hybrid direction supersedes the product assumption of tenant-owned accounts only, but it does not silently amend `docs/ADR-042-META-WHATSAPP-CLOUD-API.md`. Reconcile the ADR through architecture review before account ownership/onboarding changes. Inspect the existing `WhatsAppIntegration` schema, runtime configuration, template mapping, and webhook routing before proposing implementation. This roadmap update does not approve provider credentials, webhook tenant routing, schema migrations, or other C2/C3 changes. No migration may be generated/applied without the relevant explicit approval.

Principle:

> Prioritize problems observed in real salon usage.

### Commercial SaaS
- subscription plans
- billing
- payment provider
- invoices
- usage limits
- plan entitlements
- subscription lifecycle

### Analytics
- appointments
- revenue
- customers
- popular services
- cancellation rate
- occupancy
- staff utilization
- peak hours
- repeat customers

### Retention
- reminders
- repeat visits
- campaigns
- review requests
- segmentation
- reactivation
- personalized communication

### Advanced Operations
- multi-location
- advanced staff scheduling
- resource/chair management
- inventory
- payroll integrations
- accounting integrations
- advanced reporting

### AI
AI is not an MVP dependency. It comes after reliable operational data exists.

Possible future assistant capabilities:
- explain appointment changes
- identify profitable services
- identify unused capacity
- recommend reminder timing
- identify staff capacity opportunities
- suggest capacity improvements

## Governance Rules

- Never weaken tenant isolation or RLS.
- Never trust client-provided tenant identifiers for authorization.
- Never expand MVP scope silently.
- Do not invent missing product requirements.
- Auth/RLS architecture changes, tenant model changes, booking state changes, new external providers, and other escalated architecture concerns require explicit review and approval.
- C2/C3 implementation follows Architect → Human Approval → Builder → CI → Reviewer → Human Merge Approval → Merge.
