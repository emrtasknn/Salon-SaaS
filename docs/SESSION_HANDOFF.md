# Session Handoff — Salon SaaS

## Date / Goal
2026-11-05 — UI component kit: BoardUI + Amicro components restyled to RandevuN tokens, Inter font.

## State
- Branch / commit: `feat/ui-component-kit` (see PR)
- Environment touched: local only (dev server viewed /login; no data-changing clicks). No DB writes, no migrations.

## Done
- Tooling: BoardUI skill (`.claude/skills/boardui/`), BoardUI MCP pinned in `.mcp.json`, `components.json` (registries only).
- New: `src/components/ui/{button,input,breadcrumb,notice,motion-icons}.tsx`, `src/lib/utils.ts` (`cx`), `src/app/_ui/status-toggle.tsx`.
- Bell button with ring animation + count badge (9+) replaces the "Bildirimler N" box.
- Theme: one morphing button cycling Sistem → Açık → Koyu.
- Aktif/Pasif: eye switch (role="switch") for staff, services, platform tenants. Admin "Ben de hizmet veriyorum" checkbox styled as a switch.
- All `buttonPrimary/Secondary/Destructive*` recipes migrated to `<Button>/<ButtonLink>/<ButtonAnchor>`; field recipe restyled (filled look); local ad-hoc input/button classes unified.
- `BackLink` removed → `<Breadcrumb>` (phones show "‹ Parent").
- Inter via `next/font` (latin + latin-ext).

## Validation
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS (3 pre-existing warnings) |
| Typecheck | `npm run typecheck` | PASS |
| Unit tests | `npx vitest run src/app src/lib` (DATABASE_URL unset, no integration) | PASS 57 files / 714 tests |
| Integration | CI | pending |
| Build | `npm run build` | PASS |

## Round 2 (same PR)
- Fixed top layer `PageHeader` on all signed-in screens; bell deep links (`?date=&appointment=`) + status colors.
- Working hours: quarter-hour `TimeSelect`. Haptics (`src/lib/haptics.ts`) + "Titreşim" switch.
- **Scope change (owner decision 2026-11-05): drag-to-move in the day calendar.** Admin: any open
  appointment; active staff: own only (create scope). PENDING/CONFIRMED only, same staff/service, slot +
  closure + conflict re-check under the create advisory lock, stale guard. No migration, **no customer
  notification** (needs a new event type + Meta template → follow-up). Previously listed as deferred in
  docs/tasks/WP-08.md:16 and ADR-044 — those docs not yet updated.
- New integration test `src/persistence/prisma-booking-reschedule.integration.test.ts` (CI only).

## Decisions
- No `boardui init` / BoardUI tokens: components restyled onto existing tokens (dark mode keeps working via `data-theme`).
- Default button height kept at 44px (BoardUI uses 36px) for touch targets.
- Notifications rendered inline (`<Notice>`), not floating toasts, so live regions behave as before.

## Open risks
- Signed-in screens (admin/staff/calendar) not checked visually in this session; needs a look in the preview after sign-in.
- `npm audit` reports advisories in the dependency tree (not reviewed here).

## Next task
- Visual pass on admin/staff screens (light/dark, 375px). Optional: ui.wensity.com KPI cards for the admin home.
