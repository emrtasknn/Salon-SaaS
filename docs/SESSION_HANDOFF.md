# Session Handoff — Salon SaaS

## Date / Goal
2026-11-05 — finish MVP code work, Apple-referenced PWA design, staging prep (Supabase/Vercel), Playwright MCP.

## State
- Branch / commit: `main` @ b5a0f1c (+ this docs PR)
- Working tree: clean apart from this PR
- Environment touched: Pilot Supabase **read-only** (`_prisma_migrations` SELECT, advisors); `salon-saas-test` read-only; Vercel project created (no env vars)

## Done
- WP-10 KVKK notice / WhatsApp opt-in / contact snapshot — #149
- Staging DB = existing empty Supabase project `salon-saas-test` (owner decision; runbook §2) + pinned Playwright MCP `.mcp.json` — #150
- Apple-referenced design pass (tokens, CSS-only glass, inset lists, 44px targets, 17px inputs) — #151, review fixes #154
- Staff list/calendar show customer + service names, calendar shows booking contact — #155 (landed via #154 squash)
- Login + platform pages on the design system — #157 (landed via #154 squash)
- Staff/admin notification texts use the booking contact name — #156
- Cloud-session setup notes in `docs/AI_TOOLING.md` — #152 (owner: not needed for now)
- Vercel project `salon-saas-staging` (Next.js, Node 24.x, `lhr1`, Vercel Auth on all) — runbook §5

## Validation
| Check | Result |
|---|---|
| Lint / typecheck / targeted vitest / build | PASS on every PR above (DATABASE_URL unset) |
| CI `quality-gates` | PASS on #149–#157 |
| Visual | 375/1280px fake-data preview for booking + staff views only; no real-device check |

## Decisions
- No new UI deps: Lenis, liquid-glass-js, GSAP skipped; react-bits not copied (Commons Clause, owner to decide) — `.claude/skills/salon-saas-uiux/references/apple-design-rules.md`
- Rate-limit cleanup already exists (opportunistic delete of rows > 1 day) — no job needed

## Open risks
- Pilot DB: 11 of 18 migrations applied; 7 pending (WP-5..WP-10) — staging first, then owner-approved pilot workflow
- Pilot Supabase advisor: Leaked Password Protection disabled — owner enables in Auth settings
- Vercel staging builds fail until env vars are added (expected)
- `/reset-password` page still unstyled; retention/deletion job waits for counsel's retention period; status-link token visible in request logs (post-MVP)
- Stacked PRs merged into a non-main base: always confirm the base branch before merging

## Next task (owner, see STAGING_RUNBOOK)
1. Enable Leaked Password Protection on pilot. 2. `salon-saas-test`: set DB password, copy session-pooler URL. 3. GitHub Environment `staging` (§3). 4. Run "WP-12 Staging Supabase Migration" check → deploy (§4, §4.5). 5. Vercel staging env vars (Production scope of `salon-saas-staging`) → Redeploy (§5). 6. Auth URLs (§6), smoke test incl. KVKK flow (§7).
