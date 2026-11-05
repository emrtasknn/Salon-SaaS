# Session Handoff — Salon SaaS

## Date / Goal
2026-11-05 — Staging + pilot rollout, RLS runtime role, owner smoke-test fixes, PWA UX.

## State
- `main` @ 4b51d53 (#172). Working tree clean.
- **Pilot is live:** https://salon-saas-pilot-emre-361a.vercel.app (Vercel `salon-saas-pilot`, `dub1`, public). Always use this alias, never a deployment-specific URL (PWA installed from those never updates).
- **Staging:** Vercel `salon-saas-staging` (Vercel Auth on) + Supabase `salon-saas-test`.
- Both DBs: all 21 migrations applied, no drift. Runtime connects as **`salon_app`** (NOBYPASSRLS) on both → FORCE RLS active at runtime. Migrations keep `postgres` (GitHub secrets).
- Environment touched: staging + pilot DB migrations via guarded workflows (owner-approved; pilot without backup by owner decision, test-only data); Vercel projects created; Supabase read-only checks.

## Done (PRs)
- Infra/ops: #150 staging project + Playwright MCP, #158/#163/#167/#169 runbook + evidence, #159/#160 drift print + schema name mapping + CI drift step, #168 guarded pilot workflow (Environment `pilot`, confirm_ref, backup_taken).
- Security: #166 `salon_app` runtime role (+3 pre-context fixes), #167 Tenant RLS explicit.
- Features/UX: #151/#154 Apple design pass, #155 staff names, #156 notification names, #157 login/platform design, #161 staff temp password + invite/forgot password + staff routing, #162 notice opt-out wording, #164 tab bar + back links, #165 salon location/maps link (migration), #170 sign-in entry + salons sheet, #171 calendar timeline (Gantt), #172 customers exclude team + platform logout.

## Validation
- CI `quality-gates` green on every PR (incl. drift step, salon_app integration test).
- Owner smoke tests PASS on staging (as postgres and as salon_app) and pilot (platform list, salon pages, admin/staff flows).

## Decisions
- Staging = separate Supabase project; pilot Vercel separate project; previews off on both.
- No new UI deps (Lenis/GSAP/liquid-glass skipped; react-bits not copied).
- Staff initial password set by admin (free Supabase mailer only reaches org members).
- WhatsApp: pilot starts with it OFF (Meta business-initiated templates are paid; permanent token via System User is free). Push + status link + wa.me cover the pilot.

## Open risks / next
- Legal: owner brings counsel-approved texts → set version v1, drop TASLAK badge; DPA signature before real customers.
- WhatsApp later: System User token, payment method, templates with salon name, webhook to pilot URL, W11.5 live tests.
- Timeline limits: only staff with appointments get rows; range 08–21 not from working hours; staff row labelled "Ben".
- Vercel runtime-log review (§9) pending: needs team access approval link.
- Backup/restore rehearsal (§8) not done; Supabase Free has no downloadable backups → owner pg_dump.
- `/reset-password` page still old styling.

## Next task
- Owner device test on the alias URL (reinstall PWA), then go/no-go (WP-14) once legal is done.
