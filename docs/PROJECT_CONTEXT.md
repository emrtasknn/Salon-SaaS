# Salon SaaS — Project Context

Compact, verified orientation for agents. Link to canonical docs instead of copying them.
Last verified: 2026-11-03 against GitHub `main` @ `71d73c8` and the local working copy listing.

## Product

- Multi-tenant SaaS for appointment-based small businesses (salons, barbers, beauty centers). Source: `docs/PROJECT_GOVERNANCE.md` §1.
- Actors: `SUPER_ADMIN`, `TENANT_ADMIN`, `STAFF`, `CUSTOMER` (enum `TenantRole` in `prisma/schema.prisma`).
- MVP scope (canonical): `docs/PROJECT_GOVERNANCE.md` §4. Customer booking model: guest booking without a customer account (approved 2026-11-02, `docs/P7_PILOT_ACCEPTANCE_CHECKLIST.md`).
- Stage: foundation complete; P7 pilot acceptance OPEN, P8 production readiness BLOCKED, P9 MVP closure OPEN. Status source: `docs/ROADMAP.md` "Current checkpoint".

## Repository layout (verified)

| Path | Role |
|---|---|
| `src/domain/` | Pure business rules: tenant, authorization, availability, appointment lifecycle, working hours |
| `src/application/` | Use cases: booking engine, public booking/vitrin, calendar/CRM, staff/service/working-hours management, notification service |
| `src/persistence/` | Prisma repositories, transaction-local tenant context (`tenant-db-context.ts`), integration tests |
| `src/infrastructure/` | Supabase auth adapters, Prisma runtime, WhatsApp (Meta) provider and webhook |
| `src/app/` | Next.js routes: `[slug]` (public vitrin + `/book`), `admin`, `staff`, `platform/tenants`, `login`, `reset-password`, `api/webhooks/whatsapp` |
| `src/agent-office/` | Agent handoff/execution-state contracts + tests |
| `prisma/` | `schema.prisma`, 11 migrations (RLS in `20261005170000_rls_tenant_isolation`) |
| `public/` | PWA `manifest.json`, `sw.js` (static-asset cache only) |
| `.github/workflows/` | `ci.yml` (quality gates), `w11-4-pilot-supabase-migrate.yml` (manual, uses secret DB URL) |

## Module map (Graphify code-only run, 2026-11-03, `HEAD` `adb84ce`)

Non-test import statements between layers (top): `application→domain` 80 · `persistence→domain` 33 · `app/admin→infrastructure` 15 · `persistence→application` 15 (ports) · `app/admin→application` 12 · `app/admin→persistence` 11 · `app/[slug]→persistence` 7.
- `src/domain` imports nothing outside `domain`. No import cycles.
- Route files and server actions wire Prisma adapters directly (they are the composition root): `src/app/{admin,staff,[slug]/book,platform/tenants}/*actions.ts`, `src/app/api/webhooks/whatsapp/route.ts`, `src/app/notification-runtime.ts`.
- `src/application/{authorization-composition,identity-enrichment,server-authorization-enforcement}.ts` import `src/persistence/membership.ts` (types) — small layering leak; refactor candidate.
- Most-imported files (non-test importing files, grep-verified; change = wide blast radius): `domain/tenant-context.ts` (29), `domain/auth-identity.ts` (23), `persistence/prisma-tenant-context.ts` (14, every Prisma adapter), `domain/appointment.ts` (12), `infrastructure/prisma-runtime.ts` (11), `domain/working-hours.ts` (10), `domain/authorization.ts` (8).
- Low-cohesion modules (split candidates): `src/app/admin/actions.ts` (243 lines; services, staff, working hours), `src/app/staff/actions.ts`.
- Not in code: payment/subscription (0 matches). `schema.prisma` is not parsed by Graphify — read it directly.
- Lookup: `graphify explain "<symbol>"` / `graphify path "A" "B"` (see `docs/AI_TOOLING.md`).

## Stack (from `package.json`)

Next.js 16.3.8 · React 19.2.8 · TypeScript 5 · Tailwind 4 · Prisma 7.10 (`@prisma/adapter-pg`, generated client in `src/generated/`) · Supabase SSR/JS · Vitest 4.1 · ESLint 9. Package manager: npm (`package-lock.json`). Deployment platform: not chosen/recorded (TBD, see P8).

## Security invariants (canonical files)

- Request flow: authenticated identity → trusted tenant context → authorization → operation → RLS as defense in depth (`docs/PROJECT_GOVERNANCE.md` §6).
- DB tenant context is transaction-local `set_config('app.tenant_id', $1, true)` (`docs/RLS_TENANT_ISOLATION.md`). Never session-level.
- Client-provided tenant IDs are never authority. Public pages resolve tenant from slug server-side.
- Booking: availability is advisory; final creation re-checks conflicts transactionally (`docs/PROJECT_GOVERNANCE.md` §7).
- Notifications: provider-neutral `NotificationService`; `UNKNOWN` deliveries are never auto-retried (`docs/P7_*`).
- Env vars used by code: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `WHATSAPP_*`. No `.env.example` exists yet.

## Canonical documentation

| Topic | File |
|---|---|
| Governance / scope / priorities | `docs/PROJECT_GOVERNANCE.md` |
| Agent workflow & roles | `docs/AGENT_OFFICE_OS.md`, `docs/AGENT_OFFICE_OPERATING_PROCEDURE.md` |
| Roadmap / status | `docs/ROADMAP.md` |
| Tenant isolation / RLS | `docs/RLS_TENANT_ISOLATION.md` |
| Auth / authorization | `docs/AUTH_*.md`, `docs/AUTHORIZATION_*.md`, `docs/SERVER_AUTHORIZATION_ENFORCEMENT.md` |
| WhatsApp | `docs/ADR-042-META-WHATSAPP-CLOUD-API.md`, `docs/W11.5_*`, `docs/W11.6_*` |
| PWA | `docs/ADR-043-PWA-FIRST-MOBILE-STRATEGY.md` |
| UI/UX | `docs/w10-uiux/`, `.claude/agents/salon-saas-uiux.md` |
| Release gates | `docs/P7_*`, `docs/P8_*`, `docs/P9_*`, `docs/DESKTOP_HANDOFF_W11_6_P7_P8_P9.md` |
| Phase specs | `docs/phases/PHASE_A..D_*.md` |

## Local environment facts

- Active local working copy: `C:\Users\emret\OneDrive\Masaüstü\proje\Salon SaaS\Salon-SaaS\salon-saas` (git branch `staging/webhook` on 2026-11-03, with uncommitted changes). Sibling folders (`salon-saas-app`, `-sync`, `-notifications`, `-worktree-sw`, backups) are other copies — see `docs/DISK_CLEANUP_POLICY.md`.
- The folder is inside OneDrive (synced). Keep secrets out of plain-text files there.
- `.ai-memory.toml` binds the local ai-memory MCP to workspace `default`, project `emrtasknn-salon-saas`.
- Local `package.json` differs from `main` (adds `@emnapi/core`/`@emnapi/runtime` optional deps) — uncommitted user change, do not revert.

## Known risks / unknowns

- Local `DATABASE_URL` may target Pilot Supabase (real data). See CLAUDE.md "Local environment safety".
- `docs/README.md` still says "do not build application features until bootstrap" — stale wording; treat `docs/ROADMAP.md` checkpoint as current status.
- `AGENT_OFFICE_*` docs describe a Cline + GitHub MCP toolchain; Claude Code equivalents are listed in `docs/AI_TOOLING.md`.
- Deployment target, staging environment, branch protection: not evidenced (P8 blockers).
