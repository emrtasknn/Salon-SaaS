# W10 UI/UX Deliverables

These artifacts prepare the W10 application-integration work without changing backend architecture.

## 01 — Product UX Map

Map:
Tenant setup → Staff → Services → Working Hours → Public Vitrin → Customer Booking → Admin request → Staff decision → Appointment completion → Customer history.

## 02 — Information Architecture

Define:
- authenticated admin/staff areas
- public tenant storefront
- public booking
- customer/appointment context
- role-aware navigation

## 03 — Role Navigation

Document visibility and intended capabilities for:
- TENANT_ADMIN
- STAFF
- CUSTOMER
- public/unauthenticated visitor

Visibility never replaces server authorization.

## 04 — User Journeys

Document happy path plus:
- validation failure
- unavailable slot
- unauthorized action
- loading
- empty
- persistence/provider failure

## 05 — Design Principles

Operational clarity, one primary goal, hierarchy, accessibility, responsive behavior, consistency, security-boundary preservation, anti-slop.

## 06 — Design Tokens

Use semantic tokens by intent. Avoid raw values when a token can express the purpose.

## 07 — Component Inventory

Prioritize:
- navigation
- appointment row/card
- status
- calendar
- service/staff selectors
- forms
- feedback
- empty/error states
- public booking primitives

## 08 — Screen Specifications

At minimum:
- admin shell/dashboard
- staff appointment view
- service management
- staff management
- working hours
- admin calendar
- customer card/history
- public vitrin
- public booking
- booking result
- appointment decision surface

## 09 — Appointment UX Contract

Represent the approved lifecycle without introducing new states or transitions.

## 10 — Booking UX Contract

Expose intent and validation feedback while treating server validation as authoritative.

## 11 — Responsive Strategy

Validate 320/390/414/768/1024/1280+.

## 12 — Accessibility Contract

Keyboard, focus, semantics, contrast, touch targets, errors, reduced motion, and screen-reader semantics.

## 13 — UX Copy Guide

Short, specific, action-oriented Turkish copy. No invented business facts.

## 14 — Design QA Gates

Requirement → workflow → role → security boundary → responsive → accessibility → states → hierarchy → anti-slop → copy truth.

## 15 — Open Questions

Only unresolved decisions. Do not answer them by inference.
