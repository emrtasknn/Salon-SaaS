# Salon SaaS — Agent Instructions

## Mission

Build and maintain a secure multi-tenant salon SaaS platform without drifting from the approved architecture or scope.

## Mandatory Reading

Before any non-trivial task, read:
- docs/PROJECT_GOVERNANCE.md
- docs/AGENT_OFFICE_OS.md
- the relevant task/issue
- existing implementation and tests

## Non-Negotiables

1. Never weaken tenant isolation or RLS to make a feature work.
2. Never trust client-provided tenant identifiers for authorization.
3. Never change booking semantics without explicit approval.
4. Never invent requirements, files, APIs, test results, commits or deployment results.
5. Never delete tests solely to obtain green CI.
6. Never introduce a dependency without justification.
7. Never expand MVP scope silently.
8. Never deploy to production autonomously in v1.
9. Stop when requirements conflict.
10. Prefer the smallest safe change.

## Workflow

READ → PLAN → IMPLEMENT → TEST → REVIEW → REPORT

## Required Report

At completion report:
- changed files
- requirement IDs
- tests/checks run
- CI status if available
- migration impact
- security/tenant impact
- deviations
- remaining risks

## Escalation

Stop and escalate for:
- auth/RLS architecture changes
- tenant model changes
- booking state-machine changes
- destructive production database operations
- new external provider requirements
- unresolved product ambiguity

The source-of-truth documents in this repository take precedence over informal assumptions. Conflicts must be surfaced, not guessed through.

## UI/UX Agent

For product UI/UX work, use `.claude/agents/salon-saas-uiux.md` and `.claude/skills/salon-saas-uiux/SKILL.md`.

The UI/UX Agent is a design/quality worker inside the governed workflow. It must not change auth, RLS, tenant isolation, authorization, booking semantics, or MVP scope without escalation and approval.
