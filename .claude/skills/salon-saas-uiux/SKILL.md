---
name: salon-saas-uiux
description: Use for Salon SaaS screen/component design, UX copy, responsive layout, accessibility or UI QA. Not for backend, auth, RLS or booking logic.
---

# Salon-SaaS UI/UX Skill

Use this skill for product UI/UX architecture, screen design, component design, UX writing, responsive design, accessibility, and UI quality review.

## Source of truth

Repository governance and approved architecture take precedence over this skill.

Required context:
- `AGENTS.md`
- `docs/PROJECT_GOVERNANCE.md`
- `docs/AGENT_OFFICE_OS.md`
- relevant issue/spec
- relevant domain/application/persistence code and tests

## Visual language

The PWA uses Apple's design language as its visual reference. Before any visual/styling work, apply
`references/apple-design-rules.md` (type scale, contrast, touch targets, inset-grouped lists, glass
material limits, motion, safe areas) and use the tokens in `src/app/globals.css` and `src/app/_ui/`.

## Execution

### 1. Discover

Identify:
- user role
- primary job
- current domain state
- existing application contract
- relevant security boundary
- existing design primitives
- explicit acceptance criteria

### 2. Model

Create:
- journey
- information architecture
- role/capability matrix
- primary screen goal
- component hierarchy
- state matrix

### 3. Specify

Specify:
- layout hierarchy
- semantic tokens
- content/copy
- interaction states
- loading/empty/error/success
- responsive behavior
- accessibility
- application contract
- security boundary

### 4. Validate

Check:
- no invalid appointment actions
- no client-authority assumptions
- no cross-tenant implication
- no invented backend contract
- all important states covered
- mobile behavior is intentional
- keyboard/accessibility behavior is explicit
- visual hierarchy has one clear focal point
- content is truthful

### 5. Handoff

Produce implementation-ready artifacts. Mark unresolved dependencies as BLOCKED rather than guessing.

## Required state matrix

For significant interactive surfaces:

| State | UX requirement | Data/contract dependency |
|---|---|---|
| Default | | |
| Hover | | |
| Focus | | |
| Active/Pressed | | |
| Disabled | | |
| Loading | | |
| Error | | |
| Success | | |
| Selected | | |

Only include states relevant to the component, but do not omit a state merely because implementation is inconvenient.

## Gate

A UI/UX gate returns only:

**PASS** — verified against the available evidence.

**FAIL** — specific defects are present.

**BLOCKED** — a product/domain/backend/security dependency is unresolved.

Never use "PASS" when the implementation was not actually inspected.
