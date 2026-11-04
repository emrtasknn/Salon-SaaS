# Session Handoff — Salon SaaS

## Date / Goal
2026-11-04: WP-2b. `APPOINTMENT_CREATED` WhatsApp messages also go to the same tenant's TENANT_ADMINs (shared single Meta sender for MVP).

## State
- Branch: `claude/cool-jang-378bf2` (worktree). Local commit only; not pushed. A PR to `main` is drafted.
- Environment touched: none (no DB, migration, deploy or real Meta send).

## Done
- Plan `docs/tasks/WP-02b.md`: C3 routing change, owner-approved 2026-11-04 with the proposed defaults.
- Admin recipients for CREATED in `src/persistence/prisma-notification.ts`:
  - the lookup filters on `tenantId` explicitly, inside the tenant-context tx;
  - admins with no phone are skipped;
  - admins reuse the `appointment-created-staff` template.
- Pure `dedupeRecipients` / `phoneDedupeKey` in `src/domain/notification.ts`, deduping by profile and by staff/admin phone.
- Tests:
  - new `src/domain/notification.test.ts`;
  - `recipients()` unit tests;
  - service failure-isolation and replay tests;
  - a new CI-only integration block.
- ADR-042 addendum (shared sender for MVP) and a ROADMAP line.
- Reviewer: clean, no blocking findings.

## Validation
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS (0 errors, 4 pre-existing warnings) |
| Typecheck | `npm run typecheck` | PASS |
| Unit tests | `npx vitest run src/domain/notification.test.ts src/persistence/prisma-notification.test.ts src/application/notification-service.test.ts` | PASS (35) |
| Integration | CI | not run (CI only) |
| Build | `npm run build` | not run |

## Decisions
- Admins receive CREATED only.
- Admins reuse the staff template.
- Admins with no phone are skipped silently.
- The Meta-terms gate is NOT waived.
- Having no explicit opt-in is an accepted MVP risk.
- No migration is needed, because the NotificationDelivery unique key includes `recipientProfileId`. Recorded in the ADR-042 addendum.

## Open risks
- **Shared-sender webhook status routing.** `WhatsAppIntegration` is unique on `(provider, phoneNumberId)`, which binds the number to one tenant. Status updates for other tenants fail closed and stay at SENT. Needs a separate C3 review and probably a schema proposal.
- **The CI integration test does not exercise RLS.** It runs as a superuser, so it proves the explicit `tenantId` filter and the composite FK. A non-superuser `SET ROLE` variant is a follow-up.
- **Phone dedupe is digits only**, so `+90…` and `0…` count as different numbers.

## Next task
- Push the branch and open the PR once the owner approves; the integration tests must pass in CI.
- Then do the C3 review of shared-sender webhook routing.
