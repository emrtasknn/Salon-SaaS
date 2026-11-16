# Session Handoff — Salon SaaS

## Date / Goal
2026-11-16 — Plan tenant-owned WhatsApp Business connection; implement the pilot step (WP-15).

## State
- Branch: `claude/amazing-ramanujan-rljbe8`
- Environment touched: none (no database, no deploy, no Meta call; `DATABASE_URL` unset)

## Done
- Plan report for the owner (outside the repo): Embedded Signup self-service is Faz 1, blocked until Randevu'N can pass Meta business verification.
- Owner decisions: no in-app messaging; continue with one real pilot business and its own WhatsApp Business account (Faz 0).
- WP-15 (owner-approved C3): the configured WhatsApp sender is used only for the tenant with a matching `ACTIVE` `WhatsAppIntegration` row; other tenants get no WhatsApp. See `docs/tasks/WP-15.md`, ADR-042 addendum 2026-11-16.

## Validation
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS (3 existing warnings) |
| Typecheck | `npm run typecheck` | PASS |
| Unit tests | `npx vitest run --exclude "**/*.integration.test.ts"` | PASS (146 files, 1658 tests) |
| Integration | CI | new case (9) in `prisma-whatsapp-webhook.integration.test.ts`, not run locally |

## Open risks
- After deploy, a tenant without a matching integration row gets no WhatsApp. Verify the pilot tenant's live row before deploying.
- Meta details (coexistence without a partner, unverified-business limits, token lifetime) are unverified.
- `npm ci` fails on Node 22 / npm in the cloud container (lockfile reported out of sync for `@emnapi/*`); CI uses Node 24.11.1.

## Next task
- Owner: set up the pilot business's Meta assets and decide which number to use (WP-15 operational steps).
