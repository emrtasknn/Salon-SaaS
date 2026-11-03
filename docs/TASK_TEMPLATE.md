# Task — Salon SaaS

## Objective
[One clear outcome]

## Risk class
C0 / C1 / C2 / C3 — see `docs/WORKFLOW.md`. C2/C3 stops after the plan for human approval.

## Context
[Link canonical docs; don't paste them. Roadmap item / issue / requirement ID]

## Scope
In: [items] · Out: [items]

## Acceptance criteria
- [ ] [Observable result]
- [ ] Lint, typecheck and relevant unit tests pass; integration coverage via CI if persistence/RLS touched
- [ ] No unrelated changes, no new dependency without justification

## Start here
- Code: [paths]
- Docs: [paths from the CLAUDE.md docs map]
- Tests: [paths]

## Constraints
- `AGENTS.md` non-negotiables apply (tenant isolation, booking semantics, no silent scope expansion).
- Preserve uncommitted user work; no commit/push/deploy unless stated here.
- No local integration tests or migrations while `DATABASE_URL` is set.

## Report
`AGENTS.md` Required Report + update `docs/SESSION_HANDOFF.md`.
