# Session Handoff — Salon SaaS

## Date / Goal
2026-11-04/05 — Run the MVP work packages to code completion with agent-to-agent workflows (orchestrating session).

## State
- `main` @ `2d9a144` (after #145) + this docs PR. All MVP code packages merged; status table in `docs/tasks/README.md`.
- 6 new migrations on `main`, **none applied** to staging or pilot.
- Environment touched: none by agents (no DB, migration apply, deploy, real Meta send).

## Done
- Merged: #132 (WP-00 plan/docs), #133 (WP-2b), #134 (WP-3), #135 (WP-4), #136 + #143 (WP-11), #137 (WP-5), #138 + #145 (WP-02c), #139 (WP-12 artifacts), #140 (WP-06), #141 (WP-07), #142 (WP-08), #144 (WP-09).
- Owner decisions recorded in task files: P9 on staging + pilot; ADR-044 accepted; shared Meta sender pilot-only (production gated); WhatsApp opt-in optional; Vercel + Supabase branch + built-in logs; `web-push` MPL-2.0; device list; tenants locked to Europe/Istanbul (DST fix deferred); WP-02c Option A + HTTP 200 for unresolved statuses.
- Standing approval: main session squash-merges WP PRs when CI is green (not migrations/deploys).

## Validation
| Check | Result |
|---|---|
| Every merged PR | CI `quality-gates` green on Postgres 17 (lint, typecheck, unit + integration, build) |
| Reviewer | salon-saas-reviewer on every WP; findings fixed before merge |

## Open risks
- SECURITY DEFINER resolvers (W11.6 + WP-02c) need the owner to verify on staging/pilot that their owner bypasses RLS and the runtime role can EXECUTE (`docs/STAGING_RUNBOOK.md` §4.5); CI runs as superuser and cannot prove it.
- Meta shared-sender permission not established (WP-02); opt-in/consent storage pending WP-10.
- Disk space limits parallel worktrees; finished worktrees under `.claude/worktrees/` can be cleaned by the owner.

## WP-10 legal drafts (2026-11-04)
- `docs/legal/`: customer KVKK notice + WhatsApp opt-in (A), salon↔platform DPA + sub-processor list (B). All TASLAK; owner + counsel approve. Sources and UNVERIFIED items in `docs/legal/README.md`.
- Owner decision: no "okudum" checkbox; notice shown above submit, shown version + hash recorded per booking.
- Code gaps found while drafting (README "Uygulamaya yansıyacak"): profile reuse by email ignores new phone (wrong-recipient risk), WhatsApp templates lack salon name, no opt-in gate yet, no token revoke/cleanup, opportunistic rate-limit cleanup.

## WP-10 code (2026-11-05)
- Branch `feat/wp-10-kvkk-consent`: AppointmentContact snapshot + notice hash + WhatsApp opt-in/opt-out, tenant legal fields, migration `20261106100000` (not applied). Text is DRAFT; public launch needs counsel approval and salon legal fields filled.

## PWA Apple design pass review (2026-11-05, PR #151)
- Independent review (salon-saas-reviewer + main session): no blockers; no behavior change (field names, actions, legal text, opt-in unchecked/optional all unchanged). Contrast computed: lowest text pair 4.70:1 (`ink-muted` on glass over black).
- Fixes on `feat/pwa-apple-design-pass`: dialog backdrop blur gets reduced-transparency/more-contrast fallback; booking "closed"/"not ready" screens use tokens; long values wrap on status page and staff list; staff calendar "Randevu oluştur" moved out of the sticky bar (bar is one row on phones); `themeColor`/manifest `theme_color` → `#f2f2f7`.
- Checks (DATABASE_URL unset): lint 0 errors, typecheck, `vitest run src/app` (non-integration, 542 pass), build. Booking form + staff views rendered at 375/1280px via a temporary local preview with fake data (deleted): no horizontal overflow, no tap target < 44px.
- Not verified: real iOS/Android devices, standalone PWA safe areas, admin pages visually (need auth/DB; they set own bg and text sizes, desktop stays 16px). `/login` and `/platform/tenants` are unstyled (pre-existing) — separate follow-up.

## Next task
- Owner: WP-12 staging (create Supabase branch + Vercel env, run staging-migrate, §4.5 gate, smoke), WP-02 live tests, legal review of `docs/legal/`. Then WP-10 implementation (needs a migration slot after `20261105140000`), WP-13, WP-14.
