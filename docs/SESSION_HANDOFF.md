# Session Handoff — Salon SaaS

## Date / Goal
2026-11-14 — Bring the admin panel's account/settings design to the staff and platform (SUPER_ADMIN) areas.

## State
- Branch: `claude/funny-edison-9bnnpe`, restarted from `main` after #202 merged
- Environment touched: none (no database, no deploy; `DATABASE_URL` unset)

## Done
- One shared "Ayarlar" screen (`src/app/_ui/settings-screen.tsx`, `settings-list.tsx`) for `/admin/settings`, new `/staff/settings` and new `/platform/settings`. The platform version has no notifications row (no tenant, no push).
- Staff calendar and platform list end with the same "Hesap" rows as the admin home (Ayarlar ›, Çıkış yap). The old button row (`AccountLinks`) is removed.
- Staff home shows the push opt-in as a banner only, like the admin home; the switch is in Ayarlar.
- Staff "Randevularım" refresh button matches the calendars (icon button).

## Validation
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS (3 existing warnings) |
| Typecheck | `npm run typecheck` | PASS |
| Unit tests | `npx vitest run --exclude "**/*.integration.test.ts"` | PASS |
| Integration | CI | see PR |
| Visual | Chromium 390px dark: platform list, settings screen | checked; staff screens need a signed-in session, not shot |

## Open risks
- KVKK notice still names the party "Salon"; needs legal review before onboarding clinics.
- Lens/tab bar feel still unverified on a real iPhone.

## Next task
- Owner check on a phone: staff and platform "Hesap" → Ayarlar flow.
