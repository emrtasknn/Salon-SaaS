# Session Handoff — Salon SaaS

## Date / Goal
2026-11-19 — Motion pass: route transitions, dialog open/close, loading skeletons and pending states (owner: "karma", skeleton + spinner, everything in scope, ship it).

## State
- Branch: `claude/funny-edison-9bnnpe` (from `main` at #206)
- Environment touched: none (no database; `DATABASE_URL` unset, placeholder only for `prisma generate`)

## Done
- Route entry: `src/app/_ui/route-motion.tsx` + `route-transition.ts`; `template.tsx` in admin, staff, platform (fade / push / pop) and `[slug]` (fade only).
- Skeletons: `src/app/_ui/skeleton.tsx`, `public-skeleton.tsx`; `loading.tsx` for every admin, staff, platform and public route.
- Dialogs: CSS open/close for all sheets and dialogs (`sheet-motion`, `dialog-motion`); `AppointmentSheet` keeps its content while closing.
- Bell panel scales from the bell and closes animated; confirm rows and status notes fade in; `Notice` lost its blur.
- `Button pending` on every waiting button (login, reset password, save, create, cancel, refresh); log-out row shows a spinner; `PageHeader busy` progress bar on calendars and staff list.
- Booking: steps slide by direction, time slots show chip skeletons; lists stagger on mount.
- Tab icon pulses while its page loads (`useLinkStatus`).

## Validation
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS (3 existing warnings) |
| Typecheck | `npm run typecheck` | PASS |
| Unit tests | `npx vitest run --exclude "**/*.integration.test.ts"` | PASS |
| Integration | CI | see PR |
| Visual | Chromium 390px, temporary preview pages: sheet open/close, bell, pending, confirm, push + skeleton, pop + stagger | checked |

## Open risks
- iOS < 17.5: dialogs open/close without motion (works, just instant).
- Not checked on a real iPhone; signed-in screens were not shot with real data.
- KVKK notice still names the party "Salon".

## Next task
- Owner check on a phone: tab switches, Yönetim → Personel → back, appointment sheet, bell, booking steps.
