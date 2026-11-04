# Session Handoff — Salon SaaS

## Date / Goal
2026-11-04 — WP-5 rate limiting for public booking surfaces (owner-approved decisions in `docs/tasks/WP-05.md`).

## State
- Branch: `claude/friendly-easley-4bbf0e`, merged with `main` (incl. #136–#139); PR #137 to `main`, not merged.
- Environment touched: none (no DB connection, no migration applied, no workflow runs; `prisma generate` / build with a placeholder URL only).
- Previous session (WP-12 staging runbook/workflow/log masking): see this file at commit `fbca154`.

## Done
- `prisma/migrations/20261104100000_rate_limit` — `private."RateLimitBucket"` + `private.rate_limit_hit` (SECURITY DEFINER, `search_path=''`, FORCE RLS + flag-gated policy `TO postgres`, opportunistic cleanup).
- Limiter: `src/application/rate-limit.ts` (policies, fail-open, skip on missing subject), `src/infrastructure/client-ip.ts` (`TRUSTED_IP_HEADER`, IPv6 /64), `src/infrastructure/rate-limit-secret.ts` (HMAC), `src/persistence/prisma-rate-limit.ts`, `src/app/rate-limit-runtime.ts` (reusable by WP-6), `src/instrumentation.ts` (production startup check for the secret).
- Wired into `submitBooking` (tenant+IP, IP global, tenant+phone) and `getPublicAvailability` (IP); `form.tsx` shows the rate-limited message. Login out of scope (Supabase Auth limits).
- Docs: `docs/RLS_TENANT_ISOLATION.md` (non-tenant `private` tables), P8 checklist rate-limit line, `.env.example`.
- Reviewer (salon-saas-reviewer): approve; mediums fixed (merge main, docs), lows fixed (integration-test window, env comment) or noted below.

## Validation
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS (0 errors, 4 pre-existing warnings) |
| Typecheck | `npm run typecheck` | PASS |
| Unit tests | `env -u DATABASE_URL npx vitest run` on the 7 WP-5 unit files | PASS (136) |
| Build | `npm run build` (placeholder DB URL) | PASS after merge with `main` |
| Integration | PR #137 CI | pending |

## Decisions
- Phone subject canonicalised to digits with Türkiye default (`+90…`, `0…`, `5…` share one bucket).
- Missing secret: production fails at startup; dev/test disable the limiter with a warning.

## Open risks
- `staging-migrate.yml` (from #139) could apply this migration to staging once merged; owner approved CI validation only — staging/Pilot apply needs separate approval.
- Vercel previews run with `NODE_ENV=production` and need `RATE_LIMIT_HMAC_SECRET`, otherwise they refuse to start.
- Phone bucket (3/h) counts failed attempts too; a known number can be locked out for an hour. Tune after Pilot.
- Owner: run `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='postgres'` on Pilot; check Supabase Auth rate-limit settings.

## Next task
- WP-6 status link `/[slug]/randevu/[token]`: reuse `checkRateLimit` with `status.view` / `status.miss` buckets.
