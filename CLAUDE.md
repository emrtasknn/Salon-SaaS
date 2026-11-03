# Salon SaaS — Claude Code Instructions

Multi-tenant appointment SaaS for salons/barbers (Next.js 16 App Router · TypeScript · Prisma 7 · PostgreSQL/Supabase with RLS).
Repository-wide non-negotiables live in `AGENTS.md` and are loaded here:

@AGENTS.md

## Local environment safety (read first)

- The local `DATABASE_URL` has historically pointed to the **Pilot Supabase project (real data, labeled production)**.
- Never run `npm test`, `*.integration.test.ts`, `npx prisma migrate *`, seed/cleanup scripts or write SQL locally while `DATABASE_URL` is set. Integration tests run automatically whenever `DATABASE_URL` is present and they write/clean fixtures.
- Integration tests are validated by GitHub Actions on isolated PostgreSQL 17 (`.github/workflows/ci.yml`).
- Never print, copy or commit values from `.env`, `.env.local` or tokens. Ask the user to rotate anything that leaks.
- No production deploy, migration or data change without explicit human approval (see `docs/P8_PRODUCTION_READINESS_CHECKLIST.md`).

## Verified commands (from `package.json` / CI)

| Purpose | Command | Notes |
|---|---|---|
| Install | `npm ci` | CI uses Node 24.11.1. `postinstall` runs `prisma generate`, which needs `DATABASE_URL` defined (it does not connect). |
| Lint | `npm run lint` | ESLint 9 |
| Typecheck | `npm run typecheck` | `tsc --noEmit`; needs generated client in `src/generated/` |
| Unit test (targeted) | `npx vitest run <path/to/file.test.ts>` | Only with `DATABASE_URL` unset; never target `*.integration.test.ts` locally |
| All tests | `npm test` | CI only, or an isolated local DB the user explicitly provides |
| Build | `npm run build` | Next.js production build |

## Context budget rules

- Do not audit the whole repository for ordinary tasks. Read the docs map below and open only the files the task needs.
- `docs/` is ~200 KB. Never read it wholesale. For large docs (`ROADMAP.md`, `W11_IMPLEMENTATION_PLAN.md`, `W11.5_META_WHATSAPP_PILOT_PLAN.md`, P7/P8/P9 checklists), grep for the relevant section first.
- Never load `package-lock.json`, `node_modules/`, `.next/`, `src/generated/`, `tsconfig.tsbuildinfo`, `prisma/migrations/*` (except the one under review), or local log dumps (`*_output.txt`, `*-diff.txt`, `*_files.txt`).
- Trim tool output: tail failing sections, use `--reporter=dot`-style summaries, don't paste full logs.
- Don't re-run a check that already passed this session unless relevant files changed.
- Don't create new summary docs; update the canonical file or `docs/SESSION_HANDOFF.md`.

## Docs map — read only what the task needs

| Task type | Read |
|---|---|
| Any non-trivial task | `docs/PROJECT_CONTEXT.md`, `docs/WORKFLOW.md` |
| Scope / priority / status | `docs/ROADMAP.md` (current checkpoint section), `docs/PROJECT_GOVERNANCE.md` §4 |
| Auth / tenant / RLS | `docs/RLS_TENANT_ISOLATION.md`, `docs/AUTHORIZATION_COMPOSITION.md`, `docs/SERVER_AUTHORIZATION_ENFORCEMENT.md`, `docs/AUTHENTICATED_TENANT_BINDING.md` |
| Booking / availability | `docs/PROJECT_GOVERNANCE.md` §7, `src/domain/availability.ts`, `src/application/booking-engine.ts` |
| Notifications / WhatsApp | `docs/ADR-042-META-WHATSAPP-CLOUD-API.md`, `docs/W11.6_WHATSAPP_TENANT_ROUTING_C3.md`, `src/application/notification-service.ts` |
| PWA / Web Push | `docs/ADR-043-PWA-FIRST-MOBILE-STRATEGY.md`, `AGENTS.md` PWA rules |
| UI / UX | `.claude/agents/salon-saas-uiux.md`, `.claude/skills/salon-saas-uiux/SKILL.md`, `docs/w10-uiux/` |
| Release gates | `docs/P7_*`, `docs/P8_*`, `docs/P9_*` |
| Disk cleanup / backups | `docs/DISK_CLEANUP_POLICY.md` |
| Skills / agents / MCP / external repos | `docs/AI_TOOLING.md` |

## Git safety

- Start with `git status --short --branch`; the local copy often has uncommitted user work on a non-`main` branch. Preserve it.
- No `reset --hard`, `clean`, history rewrite, branch deletion or force push without explicit approval.
- Commit / push / merge only when explicitly asked.

## Session end

Overwrite `docs/SESSION_HANDOFF.md` using `docs/SESSION_HANDOFF_TEMPLATE.md` (latest session only, short).
