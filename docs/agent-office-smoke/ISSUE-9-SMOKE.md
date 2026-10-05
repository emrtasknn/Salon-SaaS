# Issue #9 — Agent Office Execution-Loop Smoke Test

## Execution state

BACKLOG → BUILDING → VALIDATING → REVIEWING → READY_FOR_MERGE

This is a disposable C0 smoke task using the C0/C1 shortcut path documented by Agent Office v1.

## Architect handoff

- Task: #9 — Agent Office execution-loop Builder smoke test
- Risk: C0
- Acceptance:
  - exercise the existing execution-state contract;
  - prove one valid transition path;
  - prove one invalid transition is rejected;
  - consume structured Architect, Builder, and Reviewer contracts;
  - produce CI evidence;
  - do not change product/domain behavior.
- Source of truth: Issue #8 execution-loop contracts and Agent Office operating procedure.
- Expected file: src/agent-office/issue-9-smoke.test.ts
- Do not change: product/domain behavior, Prisma, auth, RLS, booking, production systems.
- Impact: DB/auth/tenant/booking = none.
- Human plan approval: not required for C0 shortcut.

## Builder handoff

Implementation is intentionally test-only. The smoke test imports the existing execution-state and handoff contracts and verifies the required behavior without adding dependencies or product logic.

## Reviewer handoff

Reviewer must independently verify:
- the diff is test/documentation-only;
- the valid path reaches READY_FOR_MERGE;
- invalid transition BACKLOG → MERGED is rejected;
- Architect/Builder/Reviewer handoff validators accept structured artifacts;
- CI is green;
- no product/domain behavior changed.

## Audit trail

GitHub Issue #9, this file, the smoke-test commit, PR, CI result, and Reviewer report form the durable execution record.
