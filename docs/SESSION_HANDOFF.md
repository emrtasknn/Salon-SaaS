# Session Handoff — Salon SaaS

## Date / Goal
2026-11-04 — MVP work packages (WP-00..WP-14) with agent-to-agent workflows; WP-00 docs hygiene; parallel WP-2b/03/04/05 sessions.

## State
- `main` now includes #133 (WP-2b), #134 (WP-3 PWA), #135 (WP-4 in-app). WP-00 PR #132 updated with `main` (conflicts in ROADMAP and this file resolved).
- WP-05 rate-limit proposal: commit `f168350` on `claude/friendly-easley-4bbf0e`, not pushed; migration draft not applied or CI-validated.
- Environment touched: none (no DB, migrations, deploy, real Meta sends).

## Done
- Owner-approved plan in `docs/tasks/` (README = workflow + dependency table). Owner decisions recorded in Gov §4/§7, ADR-044 (Accepted + customer self-cancel), P9, ROADMAP, W11.8. `.env.example` (names only).
- WP-2b: `APPOINTMENT_CREATED` WhatsApp also to same-tenant TENANT_ADMINs (deduped by profile/phone, no-phone admins skipped, staff template reused, no migration; ADR-042 addendum).
- Agent workflows run in every WP: planner → (research/database) → owner gate → backend ∥ uiux → qa → reviewer → PR.

## Validation
| Check | Command | Result |
|---|---|---|
| WP-00 | salon-saas-reviewer; PR CI | changes requested → fixed; CI PASS before merge-from-main |
| WP-2b | lint, typecheck, 35 unit tests; reviewer | PASS; integration in CI |
| WP-3 / WP-4 | their PR CI | merged to `main` |

## Open risks
- Shared-sender webhook status routing: `WhatsAppIntegration` unique on `(provider, phoneNumberId)` binds the number to one tenant; status updates for other tenants fail closed (stay SENT). Needs C3 review, probably a schema proposal.
- WP-2b CI integration test runs as superuser (no RLS proof); non-superuser `SET ROLE` variant is a follow-up. Phone dedupe is digits-only (`+90…` vs `0…`).
- WP-05 uses fail-open and an RLS-protected non-tenant table; owner decisions pending in that session.
- Meta-terms gate for the shared sender still open (WP-02). Branch protection (WP-01) is an owner GitHub setting.
- Low disk space limits parallel worktree sessions.

## Next task
- Merge #132; owner answers WP-05 questions → PR; then schema line WP-06 → 07 → 08 → 09 serially; WP-10 research and WP-12 staging decisions in parallel.
