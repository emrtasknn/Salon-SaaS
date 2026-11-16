# Session Handoff — Salon SaaS

## Date / Goal
2026-11-16 — role-scoped archive ("soft") delete with confirmation dialog for tenant, staff, service, customer, customer note and appointment.

## State
- Branch / commit: `claude/charming-sagan-cb78jh` @ see `git log` (plan base `a14277c`)
- Working tree: clean
- Environment touched: none (no database, no deploy; migration is a proposal, not applied)

## Done
- Design: `docs/superpowers/specs/2026-11-16-delete-permissions-design.md` (owner approved)
- Plan: `docs/superpowers/plans/2026-11-16-delete-permissions.md` (owner approved), Tasks 1–12 executed by role subagents with per-task review and one whole-branch review + fix wave

## Changes
| Area | Change |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261116100000_soft_delete_columns` | `deletedAt` on Tenant, Staff, Service, Profile, Appointment (additive, NOT applied) |
| `src/domain/deletion.ts` | shared result type and appointment delete rule |
| `src/application/*-deletion.ts`, `platform-tenant-status.ts` | delete use cases, authorization and blocking rules |
| `src/persistence/prisma-*-deletion.ts`, `prisma-platform-tenants.ts` | transactional archive writes; read paths filter `deletedAt` |
| `src/persistence/prisma-membership-reader.ts` | archived tenant → `not_found` (fail-closed read filter) |
| `src/app/**/actions.ts` | seven delete actions; exact TENANT_ADMIN for tenant-scoped deletes |
| `src/app/_ui/confirm-dialog.tsx`, `delete-button.tsx`, screens | confirm dialog and delete buttons |
| `src/persistence/prisma-soft-delete.integration.test.ts` | integration suite (CI only) |

## Validation
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS (0 errors, 3 pre-existing warnings) |
| Typecheck | `npm run typecheck` | PASS |
| Unit tests | `npx vitest run --exclude '**/*.integration.test.ts'` (DATABASE_URL unset) | PASS (164 files, 1807 tests) |
| Integration | CI | not run |
| Build | `npm run build` | PASS |
| Browser | — | not run (needs DB/auth; verify on staging) |

## Decisions
- Archive instead of hard delete; no restore UI; admin accounts not deletable; staff access revoked by deleting the membership.
- Working-hours screen has no confirm dialog (no delete trigger there; closing a day is a reversible edit).
- Owner 2026-11-16: customer erasure also clears WhatsApp opt-in and its evidence (KVKK notice evidence kept); any PENDING/CONFIRMED appointment blocks staff/service/customer delete (spec amended).

## Open risks (owner decisions)
- Integration suite has never run; CI must prove it (cross-tenant, concurrency, erase with opt-in).
- Archived service name cannot be reused (`Service @@unique([tenantId, name])`); needs a partial unique index or acceptance.
- `prisma-booking-engine.ts:200` accepts a stale erased-customer id; one-line filter in a protected file (not approved yet).
- Deleted staff member's Supabase auth user remains (no access; email reuse may fail).
- Staff delete button is shown on the admin's own row (server refuses).
- Screens not browser-verified; check dialog focus/Escape/slug gate on staging.
- `npm ci` fails with npm 10 against the lockfile in the cloud sandbox; npm 11 (CI's Node 24) was used without the lockfile.

## Next task
- Open a PR (owner request needed) and let CI run the integration suite; fix what it finds. Then owner decisions on service-name reuse and the booking-engine filter. Files first: `src/persistence/prisma-soft-delete.integration.test.ts`, `prisma/schema.prisma` (Service unique).
