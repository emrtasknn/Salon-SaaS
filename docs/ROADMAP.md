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
- WhatsApp
- SMS
- review requests
- operational polish
- real-user bug fixing

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
