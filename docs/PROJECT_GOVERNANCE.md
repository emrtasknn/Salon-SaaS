# Salon SaaS — Project Governance

This document is the consolidated repository-level source of truth while the detailed governance pack is progressively organized into this repository.

## 1. Product Mission

Build a multi-tenant SaaS platform for salons, barbers and beauty centers covering:
- premium public storefront
- online appointment booking
- staff/availability management
- customer CRM
- review/feedback funnel
- WhatsApp communication
- owner/admin dashboard

Initial pilot: Levent Özlü Kuaför ve Güzellik Salonu.

## 2. Technology Baseline

- Next.js App Router
- Tailwind CSS
- TypeScript
- Node.js Server Actions / Route Handlers
- PostgreSQL / Supabase
- Prisma
- PostgreSQL Row-Level Security (RLS)
- tenant_id-based data isolation

## 3. Actors

SUPER_ADMIN — platform owner.
TENANT_ADMIN — salon owner/manager.
STAFF — employee/specialist.
CUSTOMER — end user.

## 4. MVP Scope

Must have:
- tenant creation and slug
- public storefront
- services and prices
- staff
- working hours
- availability engine
- appointment creation
- appointment status lifecycle
- owner dashboard
- staff appointment view
- customer history
- tenant isolation/RLS
- WhatsApp CTA
- review funnel
- production deployment

Post-MVP unless explicitly approved:
- payments
- subscriptions/billing automation
- loyalty
- inventory
- payroll
- accounting
- native mobile apps
- advanced AI
- complex enterprise/multi-branch features

## 5. Core Architecture

Presentation:
- app/
- components/

Application:
- server actions
- route handlers
- use-case services

Domain:
- booking engine
- tenant resolution
- authorization
- business rules

Data:
- Prisma
- PostgreSQL/Supabase

Integrations:
- WhatsApp
- Google
- optional SMS

Rule: UI components must not own authoritative business logic.

## 6. Multi-Tenancy

Every tenant-owned record must be isolated by tenant context.

Server-side rules:
1. authenticate when required
2. resolve trusted tenant context
3. authorize role and membership
4. perform the operation
5. rely on RLS as defense in depth

Never authorize from a client-provided tenant_id alone.

## 7. Booking Rules

A bookable interval must satisfy:
- active tenant
- active service
- active staff
- staff working period
- service duration + buffer fits
- no conflicting non-cancelled appointment

Conflict condition:
newStart < existingEnd AND newEnd > existingStart

Availability is advisory. Final booking creation must re-check conflicts transactionally.

Appointment lifecycle:
PENDING → CONFIRMED → COMPLETED
PENDING/CONFIRMED → CANCELLED

Invalid state transitions are rejected server-side.

Store timestamps in UTC and convert at the application/UI boundary using an explicit tenant timezone.

## 8. Security Priorities

Critical:
- cross-tenant data leakage
- authorization bypass
- appointment manipulation
- secret exposure
- unsafe database mutations

Mandatory:
- server-side authorization
- RLS
- input validation
- safe secret management
- controlled logging
- rate limiting for exposed public abuse surfaces

## 9. Definition of Done

A feature is not done until:
- implementation complete
- relevant tests pass
- typecheck/lint/build pass as applicable
- authorization is verified
- tenant impact is verified
- migration impact is handled
- acceptance criteria are met
- CI is green when applicable
- risks/deviations are recorded

## 10. Change Control

Any C2/C3 change must be explicitly reviewed.

Change questions:
WHY? WHAT? IMPACT? RISK? REQUIREMENT? ROLLBACK?

No silent scope expansion.

## 11. Decision Priority

security → data integrity → approved architecture → approved requirements → reliability → UX → visual polish → convenience
