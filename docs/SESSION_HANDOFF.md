# Session Handoff — Salon SaaS

## Date / Goal
2026-11-06 — Read-only UI/UX + PWA audit of the pilot, benchmarked against Fresha/Booksy/Calendly patterns; RandevuN design-system proposal.

## State
- Branch / commit: `main` @ 8f7f806 (no code changes)
- Working tree: `.claude/launch.json` untracked (pre-existing); this file updated
- Environment touched: Pilot (read-only browsing: public vitrin + booking form of the test tenant, login, platform panel). No form submissions, no DB writes.

## Done
- Audit report + design-system proposal published as a private artifact: https://claude.ai/artifact/CVmoaKmm5C18hKCP3wqrPj
- Code-side UI scan (salon-saas-uiux agent) and competitor pattern research (salon-saas-research agent) merged into the report.

## Validation
| Check | Command | Result |
|---|---|---|
| Lint / Typecheck / Tests / Build | — | not run (no code changes) |
| Mobile measurements | browser pane, 375×812 / 390×844, light + dark, 200% text | 29/30 targets ≥44px (WhatsApp checkbox 24px); 0 text <4.5:1; no horizontal scroll |

## Decisions
- Proposed (not applied): keep token names in `globals.css`, change values to navy `#0F172A` + emerald `#10B981` accent (text on emerald must be navy; white fails 2.54:1), warm canvas `#FAF9F7`, keep Inter.
- Proposed customer flow: 3 steps (service → staff+time → contact+confirm) with a sticky bottom bar; submit contract unchanged.

## Open risks
- Debugged (read-only): tenant admin login failure = Supabase auth "Invalid login credentials" at 09:45Z (wrong email/password, not a system bug). ROOT CAUSE of platform "Salon listesi yüklenemedi": Supavisor logs show `EMAXCONNSESSION max clients reached in session mode - pool_size: 15` (09:44:33–09:47:56Z; recovered 09:48:28 when idle sockets closed). Runtime connects as `salon_app` via the SESSION pooler (each client holds a backend); every Vercel instance has its own `pg.Pool` (default max 10, `infrastructure/prisma-runtime.ts`) and pages fire parallel queries (`Promise.all`), so 2+ warm instances exceed 15. Happened 5 times in 24h (11-05 17h, 19h, 23h, 11-06 00h, 09h UTC); 0 before 11-05 17h. Any DB page (incl. public booking) can fail in those windows; errors are swallowed (`platform/tenants/actions.ts:120`, `application/platform-tenant-status.ts:33`). Fix proposal (needs owner approval: prod env change): runtime DATABASE_URL → transaction pooler (6543), small `Pool({ max })` + idle timeout, log swallowed errors.
- Every DB request logs pg "client.query() when the client is already executing a query" deprecation: `Promise.all` inside interactive transactions (e.g. `persistence/prisma-booking-engine.ts:111`, `prisma-public-vitrin.ts:33`). This becomes an error in pg@9. Do not upgrade pg before serializing these.
- Customer-facing KVKK notice shows `[belirlenecek]` (`domain/legal-notice.ts:17,54`). Needs the platform's legal entity name (owner approval: legal text).
- Needs approval: "any staff" option, multi-service, service categories/price (schema), staff–service mapping, multi-vertical terminology, WhatsApp template rebrand at Meta.

## Fix PR (branch `fix/db-pool-exhaustion`)
- `src/infrastructure/prisma-pool-config.ts` (+test): per-instance Pool max 3 (env `DATABASE_POOL_MAX` 1-10), idle 5s, connect timeout 10s; `prisma-runtime.ts` logs idle-client pool errors.
- Platform tenant list logs the swallowed error (`platform_tenant_list_failed`, redacted).
- Manual step after merge (owner): Vercel pilot `DATABASE_URL` → Supabase transaction pooler (port 6543, user `salon_app.<ref>`), then redeploy. Checks run: targeted vitest 88/88, typecheck PASS, lint 0 errors.

## Next task
- Debug the platform list / admin login failure first. Then PR 1: token/colour update + contrast test (`src/app/globals.css`, `src/app/_ui/theme-contrast.test.ts`, `public/manifest.json`).
