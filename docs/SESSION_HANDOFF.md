# Session Handoff — Salon SaaS

## Date / Goal
2026-11-04 — WP-07 salon settings + tenant ACTIVE/INACTIVE + wa.me CTA (owner decisions in `docs/tasks/WP-07.md` agent log).

## State
- Branch: `claude/optimistic-heyrovsky-a0edaa`, based on `main` 786a5f1 (incl. WP-05 #137, WP-06 #140); PR to `main`, not merged.
- Environment touched: none (no DB connection, no migration applied; `prisma generate` / `npm ci` / build with a placeholder URL only).
- Previous session (WP-5 rate limiting): see this file at commit `90e9023`.

## Done
- Migration `prisma/migrations/20261104120000_tenant_status_contact_phone` — `TenantStatus` enum, `Tenant.status` default ACTIVE, nullable `Tenant.contactPhone` + E.164 CHECK. Owner-approved for PR; apply needs separate approval.
- Active-tenant booking rule: `src/persistence/tenant-status-guard.ts` reads status `FOR SHARE` inside the booking tx (public booking + admin/staff booking engine), after the advisory lock, before conflict checks → `TENANT_INACTIVE`. Availability returns no slots for inactive tenants.
- Salon settings: `src/app/admin/settings-actions.ts` (name + contact phone; TENANT_ADMIN of session tenant only), `tenant-settings-form.tsx`, inactive banner in `/admin`.
- Platform: `listPlatformTenants` / `setTenantStatusAction` (SUPER_ADMIN only), `tenant-status-list.tsx`; provisioning timezone defaults to `Europe/Istanbul`.
- Storefront: `[slug]` and `[slug]/book` show "online randevu alınmıyor" + wa.me CTA when inactive; CTA only when a validated phone exists. WP-06 status link / self-cancel unchanged.

## Validation
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS (0 errors, 4 pre-existing warnings) |
| Typecheck | `npm run typecheck` | PASS |
| Unit tests | `vitest run --exclude "**/*.integration.test.ts"` (DATABASE_URL unset) | PASS 75 files / 699 tests |
| Integration | CI (new `prisma-tenant-settings.integration.test.ts`, extended public-booking + access-token tests) | not run locally — see PR CI |
| Build | `npm run build` | PASS |

## Decisions
- (a) status toggle SUPER_ADMIN only; (b) inactive page = name + notice + wa.me; (c) staff/admin login allowed, no new bookings on any path; (d) timezone not editable, default Europe/Istanbul — `docs/tasks/WP-07.md`.

## Open risks
- `Tenant` table has no RLS / no REVOKE from anon/authenticated — separate work item proposed (guarded REVOKE migration).
- FOR SHARE serialization vs. concurrent status toggle has no concurrency test.

## Next task
- After CI green + merge: owner approval to apply `20261104120000_tenant_status_contact_phone`; then WP-08 (touches booking — sequence after WP-07).
