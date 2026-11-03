# Claude Code Task Workflow — Salon SaaS

Practical, token-efficient execution of the governed workflow in `docs/AGENT_OFFICE_OS.md`
(READ → PLAN → IMPLEMENT → TEST → REVIEW → REPORT). This file does not replace it.

## Risk path

| Change | Path |
|---|---|
| C0/C1 (docs, copy, small isolated fix) | Inspect → implement → targeted check → report |
| C2/C3 (auth, RLS, tenant model, booking state machine, schema/migration, new provider, MVP scope) | Architect plan → **explicit human approval** → build → CI → independent review → human merge |

The repo uses C0–C3 labels but has no formal per-class definition yet; when unsure, treat as C2.

## Steps

1. **Scope** — restate the outcome and acceptance criteria in 1–3 lines. Identify task type (feature, fix, docs, security, migration, release, cleanup).
2. **Inspect** — `git status --short --branch`; open only the docs listed for that task type in `CLAUDE.md`; locate code with targeted `grep`/glob, not full reads.
3. **Plan** — short for C0/C1; for C2/C3 write the handoff fields required by `docs/AGENT_OFFICE_OS.md` §8 and stop for approval.
4. **Implement** — smallest coherent change, existing patterns, no unrelated refactors, no new dependency without justification.
5. **Validate** — commands from `CLAUDE.md` only. Locally: lint, typecheck, targeted unit tests with `DATABASE_URL` unset. Integration tests: CI.
6. **Review** — read your own diff: secrets, tenant boundary, booking semantics, generated files, stray logs.
7. **Report & handoff** — `AGENTS.md` "Required Report" fields + overwrite `docs/SESSION_HANDOFF.md`.

## Context efficiency by task type

| Task | Load | Skip |
|---|---|---|
| UI change | target route/component, its application use case, UI/UX skill | persistence internals, migrations, W11 plans |
| Booking/availability | `src/domain/availability.ts`, `src/application/booking-engine.ts`, related tests, governance §7 | UI docs, WhatsApp docs |
| Tenant/auth/RLS | RLS + authorization docs, `src/persistence/tenant-db-context.ts`, related integration tests | UI docs |
| DB/migration | `prisma/schema.prisma`, the latest relevant migration, RLS doc | all other migrations |
| Notifications | `src/application/notification-service.ts`, `src/infrastructure/notifications.ts`, ADR-042, W11.6 | booking/UI code |
| CI | `.github/workflows/*.yml`, `package.json` | app code |

Additional rules:
- Read big docs by section (`grep -n "^## " file` then read the range).
- Summarize long output; keep only the failing test name, assertion and file:line.
- Don't repeat a passed check unless relevant files or deps changed; run one final check before reporting.
- If scope is unclear, search narrowly first and widen only when a dependency or security concern requires it.

## High-risk work

Before destructive, production, security-boundary or data-migration operations: explain impact, state rollback path, get explicit approval in chat. A general "go ahead" on a task is not approval for these.
