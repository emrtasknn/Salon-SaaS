# Session Handoff — Salon SaaS

## Date / Goal
2026-11-04 — WP-09 Web Push for staff + tenant admins on installed PWAs (owner decisions in `docs/tasks/WP-09.md`).

## State
- Branch: `claude/ecstatic-sammet-fcaab8`, based on `main` (f7bb4c9, incl. WP-08 #142 and WP-11 part 1 #143); PR to `main`, not merged.
- Environment touched: none (no DB connection, no migration applied; `npm ci` / `prisma generate` / build with a placeholder URL only).
- Previous session (WP-08): see this file at commit `82079bc`.

## Done
- Migration `prisma/migrations/20261105130000_web_push_subscription` — `WEB_PUSH` enum value (irreversible), `PushSubscription` (unique per `(tenantId, endpoint)`, composite FK to Profile, key CHECKs 87/22 chars, https endpoint), RLS ENABLE + FORCE + 4 policies. Owner-approved for PR; apply needs separate approval.
- `web-push` 3.6.7 (MPL-2.0, unmodified) + `@types/web-push` 3.6.4, exact pins. VAPID env names in `.env.example` (empty).
- Multi-channel `NotificationService`: WhatsApp and push run independently (`allSettled`), results carry `channel`; push on APPOINTMENT_CREATED to ACTIVE assigned staff + all TENANT_ADMIN; TTL 24h, urgency high; 404/410 revoke, 429/5xx/network revoke at 5, 400/403/413 never revoke. No delivery row without an active subscription (ADR-044 §4.1/§4.2 amended).
- Subscribe/unsubscribe server actions bound to session + membership; inactive staff/tenant FORBIDDEN.
- UI: `src/app/pwa/push-permission.tsx` on admin + staff pages (prompt only from a tap, iOS install hint, re-bind on app open); `public/sw.js` push + notificationclick (allowlisted URLs); admin logout releases the subscription.

## Validation
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS (0 errors, 4 pre-existing warnings) |
| Typecheck | `npm run typecheck` | PASS |
| Unit tests | `npx vitest run --exclude '**/*.integration.test.ts'` (DATABASE_URL unset) | PASS 1015 + 1 todo |
| Integration | CI | pending (new `prisma-push-subscription.integration.test.ts`, extended `prisma-notification.integration.test.ts`) |
| Build | `npm run build` | PASS |

## Open risks
- No staff logout control exists → staff device rows released only via "Kapat", rebind or 410.
- Push fan-out is sequential per recipient on the booking request path (worst case recipients × 5 s).
- `getWebPushConfigAction` shows the button to inactive staff/tenant (subscribe fails closed).
- `sw.js` notificationclick may open a duplicate window for an uncontrolled client.
- Admin/staff-created appointments send no push (N1, deferred). Bad VAPID → 403 logged, no alert yet.

## Next task
- CI green → main session merges; WP-11 part 2 (PushSubscription RLS regression); WP-13 real-device evidence.
