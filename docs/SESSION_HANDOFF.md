# Session Handoff — Salon SaaS

## Date / Goal
2026-11-06 (cloud) — finish the "Next task" list: working hours single save, week view on phones, "any staff", staff–service mapping, multi-service.

## State
- Merged to main (squash, CI green): #194 (working hours one save + phone week agenda), #195 ("Fark etmez" any staff).
- Open: **#196** on `feat/completion-rules-pjkk8c` — staff–service mapping + multi-service, **2 migrations**, CI green. Waiting for owner: apply both migrations to staging, then pilot, then merge.
- main auto-deploys to BOTH staging and pilot (no PR previews). Booking changes reach real customers on merge.
- Environment touched: staging + pilot read-only (Vercel deployments/runtime errors, Supabase logs). Staging writes: 2 test bookings on `uiux-test-salon`, both cancelled via their status links.
- Cloud env `Salon-SaaS` (personal) allows `salon-saas-staging.vercel.app`; Vercel share link used for SSO.

## Decisions (owner, 2026-11-06)
- Multi-service = same staff, back to back; time = Σ(duration + buffer); max 5. Public booking only; admin/staff create stays single-service.
- Staff–service default = no mapping means every service.
- "Fark etmez" default chip when several staff; server assigns least-busy free staff (retry on race).

## Validation
| Check | Result |
|---|---|
| `npm run typecheck` / `npm run lint` | PASS / 0 errors |
| `npx vitest run src` (no DB) | 1571 pass |
| CI #196 (incl. new integration tests) | PASS |
| Staging browser (#195) | single-staff flow OK; "Fark etmez" not visible there (1 staff) |

## Open risks / owner actions
- Apply #196 migrations (staging → pilot), merge, then browser-check: map staff, book 2 services, drag-move it.
- Staging tenant has 1 staff: add a second one to test "Fark etmez" live.
- Follow-up: pg@9 `client.query()` deprecation; admin/staff create flows are single-service.
- Staging test tenant `uiux-test-salon`: delete after the audit.

## Next task
- After #196: staging check, then consider multi-service in admin create, price on staff views.
