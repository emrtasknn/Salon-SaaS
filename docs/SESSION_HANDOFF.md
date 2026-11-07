# Session Handoff — Salon SaaS

## Date / Goal
2026-11-07 — customer SMS via Twilio (trial) instead of waiting for a WhatsApp number.

## State
- Branch `feat/twilio-sms` (from main @ a18a48d, #198). Nothing committed, nothing pushed, no PR.
- Uncommitted: `prisma/schema.prisma`, new migration `20261112100000_notification_channel_sms`, `src/infrastructure/twilio-sms.ts` (+test), `src/application/notification-service.ts` (+ `.sms.test.ts`), `src/domain/notification.ts`, `src/domain/legal-notice.ts`, `src/app/notification-runtime.ts`, customer/staff copy in `src/app/**`, `docs/legal/*`, `.env.example`.
- Environment touched: local only (`prisma generate` with a dummy URL). No DB, Vercel or Twilio calls.
- Meta: business "Salon SaaS" profile complete, not verified (owner has no company yet); no WhatsApp number added.

## Done
- SMS channel (`NotificationChannel.SMS`), Twilio provider (basic auth: auth token or API key; sender: messaging service or number).
- SMS only to customers with the existing opt-in, only for confirmed / rejected / rescheduled; never staff/admin, never "created". Text converted to plain ASCII (1 GSM segment).
- Opt-in + notice texts made channel-neutral (SMS or WhatsApp), versions bumped to `draft-2026-11-07`; Twilio added to sub-processors.

## Validation
| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS |
| Lint | `npx eslint <changed files>` | PASS |
| Unit tests | `npx vitest run --exclude "**/*.integration.test.ts"` (no DATABASE_URL) | PASS (135 files, 1597 tests) |
| Integration / build | CI | not run (no PR yet) |

## Decisions (owner, 2026-11-07)
- One channel-neutral opt-in for SMS + WhatsApp; SMS events = confirmed / rejected / rescheduled; ASCII text; add enum migration.

## Open risks / owner actions
- Migration must be applied to staging, then pilot, BEFORE merge (code writes `SMS` rows when Twilio env is set). Without Twilio env the code does not need it. PR needs label `pilot-migrated`.
- Set Twilio env on Vercel (staging first): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (or `TWILIO_API_KEY_SID`+`TWILIO_API_KEY_SECRET`), `TWILIO_FROM_NUMBER` (or `TWILIO_MESSAGING_SERVICE_SID`).
- Trial: delivers only to numbers verified in Twilio; adds a trial prefix; Turkey must be enabled in Messaging Geo Permissions. Unverified recipient → FAILED `TWILIO_21608`.
- Legal texts are still drafts; Twilio (US transfer) needs lawyer review before real customers.
- Not verified live: real SMS send (needs Twilio env on staging).

## Next task
- Owner: review diff → commit/PR → apply migration (staging, pilot) → set Twilio env on staging → book + confirm a test appointment with a verified number.
