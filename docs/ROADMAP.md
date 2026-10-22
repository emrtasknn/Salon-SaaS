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

## Current Implementation Checkpoint — 2026-10-22

This checkpoint records merged implementation and validation evidence. It does not override the detailed W11 plans or imply pilot/production readiness.

### Recently completed and merged

- **PR #97 — RLS integration test harness:** fixed tenant-context-aware fixture setup/cleanup and expanded WhatsAppIntegration coverage for tenant read isolation, missing tenant context, and cross-tenant mutation. GitHub Actions validated on isolated PostgreSQL 17: 52 test files passed and 241 tests passed, including all 5 RLS integration tests. This is CI database evidence, not proof that the full two-real-tenant pilot scenario has passed.
- **PR #98 — staff Auth/tenant binding:** staff provisioning now binds the new Auth user to the trusted tenant through the existing server-side adapter, fails closed and compensates when binding fails, and rolls back a new binding when staff persistence conflicts. This does not automatically repair the existing Pilot Staff account; that remains a separate controlled follow-up.
- **PR #99 — admin calendar display names:** the admin calendar now displays staff, customer, and service names instead of raw IDs, and admin management links to the calendar. Local typecheck and test evidence was reported; 237 tests passed and 5 RLS integration tests were skipped in that local run. The calendar workflow was manually exercised in the local browser, including completing an appointment.

### Remaining W11 gates

- **W11.4:** real Supabase pilot work is at final closeout, but the documented two-real-tenant cross-tenant pilot scenario and authenticated cross-tenant public-booking scenario remain blocked until a second tenant is created through the supported provisioning boundary.
- **W11.5:** real Meta WhatsApp outbound template, delivery, failure, idempotency, and recipient-routing validation must be supported by real-provider evidence; mocks/CI alone are insufficient. Validate the approved Randevu'N shared-account direction only after the provider architecture decision is reconciled with ADR-042.
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

### WhatsApp product direction — agreed, implementation not yet authorized by this roadmap edit

- **Initial account model:** use one platform-managed Randevu'N WhatsApp Business account/number to send appointment notifications to the relevant staff member, salon owner, and customer. A separate WhatsApp Business account for every salon is not an MVP prerequisite under this product direction.
- **Initial template scope:** use centrally managed, Meta-approved templates with dynamic appointment/tenant-specific parameters. Resolve recipients and message parameters server-side from trusted appointment and tenant data.
- **Tenant isolation:** persist and resolve each tenant's notification configuration, template mapping, delivery records, and idempotency keys in tenant scope. A template mapping/configuration for one tenant must never be selected for another tenant. Never trust client-supplied tenant IDs, recipient numbers, or template identifiers for authorization.
- **Post-MVP:** allow each salon to customize message content and manage template submission/review/approval states. Do not send a template that is not approved and enabled for the applicable send.
- **Reminder scheduling:** business-configurable reminder timing and reminder lifecycle/status visibility are productization work, separate from the initial event-notification flow. Appointment changes/cancellations must safely reschedule or suppress pending reminders.
- **Architecture dependency:** this shared platform-managed account direction conflicts with the current tenant-owned WhatsApp assets assumption in `docs/ADR-042-META-WHATSAPP-CLOUD-API.md`. Reconcile ADR-042 through architecture review before implementing account ownership/onboarding changes. This roadmap update does not itself approve provider credentials, webhook routing, schema migrations, or other C2/C3 changes.

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
