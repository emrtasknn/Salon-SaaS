# Session Handoff — Salon SaaS

## Date / Goal
2026-11-19: calendar plan from the owner. Goals: a compact calendar header, more useful views, a staff home screen, and phone calendar integration (ADR-045). Owner asked to ship each part live.

## State
- Branch: `claude/amazing-dirac-nxg1k7`. PR #211 is open and waits for the migration gate.
- Merged to main (auto-deploys staging + pilot): #208, #209, #210.
- Environment touched: none of the real ones. A throwaway local PostgreSQL 16 in the container was used for the migration and integration tests.

## Done
- #208: staff home "Özet" (`/staff`); staff calendar moved to `/staff/calendar` (old deep links redirect); compact `CalendarHeader` (week strip, ⋯ menu, + button); reload on app focus; staff tour v2.
- #209: tap a free time in the day view to open create, prefilled with day, staff and time.
- #210: month agenda (selected day under the grid) and week list (Tümü/Bekleyen filter).
- #211 (open): `CalendarFeedToken` with migration `20261120100000`; `/<slug>/takvim/<token>.ics`; Ayarlar → Telefon takvimi; ADR-045.

## Validation
| Check | Command | Result |
|---|---|---|
| Lint / typecheck | `npm run lint`, `npm run typecheck` | PASS (3 old warnings) |
| Unit | `npx vitest run --exclude "**/*.integration.test.ts"` | PASS |
| Integration | full `npx vitest run` on a throwaway local PG16 | PASS, 178 files / 2023 tests |
| CI | #208–#210 | green; #211 pending |

## Decisions
- Native phone events never become appointments. Inbound sync will only create busy blocks (ADR-045 §2 E).
- Customer names may appear in the phone calendar (owner, 2026-11-19).

## Open risks / blocked
- **#211 migration:**
  - The owner applies it to staging and then the pilot (`docs/STAGING_RUNBOOK.md`).
  - Then the owner adds the label `pilot-migrated`, and the PR can be merged.
- **Phase B (Google two-way) needs from the owner:**
  - a Google Cloud project with the Calendar API enabled;
  - an OAuth consent screen and client id/secret (Vercel env);
  - architecture approval of the busy-block availability rule.
- No real signed-in phone check yet of #208–#211.

## Next task
- After #211: owner subscribes on an iPhone and in Google Calendar, then checks that an update arrives.
- Then design phase B in detail (ADR-045 §5).
