# Agent Office OS v1

## 1. Purpose

Agent Office OS is the execution layer for AI-assisted development. It does not replace project governance; it enforces it.

## 2. Organization

HUMAN OWNER
→ ARCHITECT
→ BUILDER
→ REVIEWER
→ HUMAN APPROVAL
→ MERGE
→ CI
→ RELEASE

## 3. Agent 1 — Architect

Mission:
Convert an approved task into the smallest safe implementation plan.

Reads:
- project governance
- relevant specs
- backlog/task
- current code
- ADRs/issues when relevant

Produces:
- impacted modules
- implementation plan
- data/auth/tenant/booking impact
- migration needs
- tests
- risks
- open questions

Must not implement production code or silently change scope.

## 4. Agent 2 — Builder

Mission:
Implement an approved plan with minimum scope.

Must:
- preserve architecture/contracts
- add/update tests
- run checks
- inspect diff
- report deviations

Must not:
- bypass RLS/auth
- change booking semantics without escalation
- introduce dependencies silently
- deploy to production

## 5. Agent 3 — Reviewer

Mission:
Independently judge whether a change is safe to merge.

Review order:
1. scope
2. requirements
3. security
4. tenant isolation
5. data integrity
6. booking correctness
7. error handling
8. tests
9. maintainability
10. UX

Verdicts:
PASS
CHANGES_REQUIRED
BLOCKED

Automatic blockers:
- cross-tenant exposure
- auth bypass
- double-booking vulnerability
- secret leak
- unsafe production migration
- tests removed to make CI green
- unapproved architecture change

## 6. Permissions

Architect:
read + analysis + docs/proposal.

Builder:
read + write on development branch + local tests.

Reviewer:
read + test + review.

Human:
merge + production deploy + production DB actions + governance exceptions.

Least privilege is the default.

## 7. Workflow

Normal feature:
TASK → ARCHITECT → PLAN REVIEW → BUILDER → TEST → REVIEWER → HUMAN → MERGE

C0/C1 low-risk changes may skip Architect.

C2/C3 changes require Architect plus explicit human approval before implementation when architecture/scope is affected.

## 8. Handoff

Architect → Builder must include:
- task
- acceptance criteria
- source-of-truth references
- plan
- expected files
- DB/auth/tenant/booking impact
- test plan
- risks
- do-not-change list

Builder → Reviewer must include:
- implemented changes
- files
- tests
- checks
- migration impact
- security/tenant/booking impact
- deviations
- known limitations

Reviewer → Human must include:
- verdict
- blockers
- requirement coverage
- security status
- tenant isolation status
- test status
- scope drift
- recommendation

## 9. Failure Recovery

Understanding failure → return to planning.

Implementation failure → reproduce → smallest fix → re-test.

Architectural drift → stop → restore/review → ADR/change control.

Security failure → stop → do not deploy → investigate.

Data integrity failure → stop → verify state → controlled recovery.

Agent loop/hallucination → stop after bounded retries → return to last known good state.

Suggested v1 retry budget:
- 2 implementation attempts
- 1 architecture re-evaluation
- then human escalation

## 10. Evaluation

Measure:
- planning revision rate
- first-pass test rate
- regression rate
- scope drift
- defects caught before merge
- failed deployments
- production incidents caused by agent changes

v1 target: stable multi-agent handoffs under human approval.

## 11. Memory

Stable rules live in version-controlled docs.

Task context lives in issues/handoff packets.

Important decisions never live only in chat/model memory.

## 12. Golden Rule

Agents are workers inside a governed engineering system. They are not the source of product truth.
