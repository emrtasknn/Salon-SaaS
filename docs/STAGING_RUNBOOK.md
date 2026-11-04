# Staging Runbook (WP-12)

Owner-executed. Agents prepare this runbook, `.github/workflows/staging-migrate.yml` and code; **agents never create branches, change env vars, run migrations or deploy.** Every step below is done by the owner, and each environment change is approved per `docs/P8_PRODUCTION_READINESS_CHECKLIST.md` → "Deployment authorization boundary".

Owner decisions (2026-11-04, `docs/tasks/WP-12.md`): hosting **Vercel**; staging DB **persistent Supabase branch of the pilot project**; monitoring **Vercel + Supabase built-in logs + simple uptime check** (no new dependency). Production deploy is approved separately.

> **Recorded deviation:** WP-12 scope / P8 §H originally said "new staging Supabase project". The owner chose a branch of the pilot project, which shares the org, billing and base auth settings. Owner to confirm acceptance in the WP-12 agent log.

Facts below were checked against vendor docs on 2026-11-04 (sources at the end). Items marked **(verify)** were not confirmed in docs; check them in the dashboard.

## 0. Rules for the whole runbook

- Never copy real pilot data into staging. Do **not** tick "Include data" when creating the branch.
- Migrations always go to staging first, then pilot.
- Staging credentials are separate from pilot and **never** go into a local `.env` / `DATABASE_URL`. Local integration tests write fixtures.
- Secret values live only in Vercel env vars and GitHub Environment secrets. `.env.example` lists names only.
- Do **not** install the Supabase ↔ Vercel Marketplace integration on this project. It writes Supabase env vars into Vercel on its own and could put pilot credentials into Preview/staging.
- Keep the Supabase GitHub integration (automatic branch migrations) **off**. It applies `supabase/migrations`, and we use Prisma's `prisma/migrations`.

## 1. Environment inventory (names only)

| Where | Name | Staging value source |
|---|---|---|
| Vercel (staging env) | `DATABASE_URL` | Staging branch, pooler URL (same pooler mode as pilot runtime) |
| Vercel (staging env) | `NEXT_PUBLIC_SUPABASE_URL` | Staging branch → Settings → API |
| Vercel (staging env) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging branch → Settings → API |
| Vercel (staging env) | `SUPABASE_SERVICE_ROLE_KEY` | Staging branch → Settings → API (server only) |
| Vercel (staging env) | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_TEMPLATES_JSON`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Meta test number/app only, or leave unset to keep WhatsApp off on staging |
| GitHub Environment `staging` | secret `STAGING_DATABASE_URL` | Staging branch **session pooler, port 5432** (GitHub runners are IPv4; the direct host is IPv6 unless the IPv4 add-on is on) |
| GitHub Environment `staging` | variable `STAGING_SUPABASE_PROJECT_REF` | Staging branch project ref |
| GitHub Environment `staging` | variable `PILOT_SUPABASE_PROJECT_REF` | Pilot project ref (used only to block the wrong target) |
| GitHub repo secret (existing) | `DATABASE_URL` | Pilot. Used only by `w11-4-pilot-supabase-migrate.yml`. Not touched here. |

Why `STAGING_DATABASE_URL` and not `DATABASE_URL`: if an Environment secret is missing, GitHub falls back to the repo secret with the same name, which is pilot.

## 2. Create the Supabase staging branch

1. Supabase dashboard → pilot project → Branches → **Create branch** → name `staging`, type **persistent**. Leave "Include data" **off**. No GitHub integration.
2. Wait until the branch status is healthy. Record its **project ref** (from the branch's Settings → General or API URL). **(verify)** the branch has its own ref, DB password and pooler hosts.
3. Branch → Settings → Database → reset/set the DB password; keep it in your password manager only.
4. Copy the **session pooler** connection string (port 5432). The pooler username contains the branch ref (`postgres.<ref>`), which the workflow's guard checks.
5. **(verify)** the branch is empty before the first deploy: in the branch SQL editor, `select count(*) from information_schema.tables where table_schema = 'public';` returns 0 (no copied tables or data).
6. Cost note: persistent branches stay on and are billed by compute hours (Micro ≈ $0.01344/h ≈ $10/month).

Evidence to record: branch name, ref, region, created timestamp (no secrets).

## 3. GitHub Environment

1. Repo → Settings → Environments → **New environment** `staging`.
2. Required reviewers: owner. Deployment branches: `main` only (optionally also release branches).
3. Add secret `STAGING_DATABASE_URL` and variables `STAGING_SUPABASE_PROJECT_REF`, `PILOT_SUPABASE_PROJECT_REF` (section 1).

## 4. First migration on staging

1. Actions → **WP-12 Staging Supabase Migration** → Run workflow on `main`, mode **check**. Expected: the guard passes and `migrate status` reports pending migrations (the job fails in check mode while migrations are pending; that's expected on a fresh branch).
2. Run again, mode **deploy**, approve the environment gate. The job runs: guard → `migrate status` → `migrate deploy` → `migrate status` → drift check (`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`).
3. Expected: "No schema drift." in the job summary. Record the run URL, commit SHA and duration.
4. RLS parity (Prisma does not diff policies or grants). In the Supabase SQL editor of **staging and pilot**, run this read-only query and compare the two outputs (they must match):

```sql
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public'
order by 1, 2;

-- Non-public objects created by migrations (e.g. private.resolve_whatsapp_tenant_id)
select n.nspname, p.proname, p.prosecdef, p.proacl::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
order by 1, 2;
```

5. Every later migration: run **deploy** on staging first, smoke test (section 7), then run the pilot workflow (`w11-4-pilot-supabase-migrate.yml`) under the P8 approval sequence. Note: the pilot workflow has no GitHub Environment approval gate today; the owner's own approval is the only gate (follow-up: move it behind a `pilot` Environment with required reviewers). For each migration, write down a forward plan and a rollback plan (a new down migration; Prisma has no automatic rollback).

## 5. Vercel project and staging environment

Choose one:

- **A. Custom environment `staging`** (Vercel Pro; 1 included per project). Project → Settings → Environments → Create `staging`, track branch `staging` (or `main`), attach a domain such as `staging.<your-domain>`.
- **B. Preview branch** (all plans). Set the env vars below with scope **Preview** + **branch `staging`** only, and assign a fixed domain to that branch.

Steps:

1. Import the GitHub repo into Vercel (Framework: Next.js, Node 24). Do not add the Supabase Marketplace integration.
2. Add every name from section 1 "Vercel (staging env)" **only** to the staging environment / `staging` branch scope. Do **not** use "import from Production". Keep pilot values only in Production scope.
3. Deploy the `staging` target. Record the deployment URL and commit.

## 6. Supabase Auth URLs (staging branch)

Auth settings are copied from the pilot project when the branch is created, so they must be changed on the branch.

1. Staging branch → Authentication → URL Configuration.
2. **Site URL**: `https://staging.<your-domain>` (or the fixed Vercel staging URL). Password-recovery emails land on the Site URL; `src/app/recovery-redirect.tsx` then moves the user to `/reset-password`.
3. **Redirect URLs**: add `https://staging.<your-domain>/**`. Only if Vercel previews must log in, add `https://*-<team-slug>.vercel.app/**`.
4. Check the pilot project's URL settings did **not** change.
5. Email: staging uses the default Supabase mailer or its own SMTP; never pilot customer addresses. Use test accounts only.

Evidence: screenshot of URL config (no keys), successful login and reset-password test (section 7).

## 7. Staging smoke checklist

Use test accounts and fake customer data only. Record date, commit, tester, pass/fail.

- [ ] `/` loads over HTTPS; PWA manifest and icons load.
- [ ] Login with a test tenant admin → dashboard.
- [ ] Logout → protected page redirects to login.
- [ ] Forgot password → email arrives → link opens the **staging** site → `/reset-password` → new password works.
- [ ] Owner: create service, staff, working hours.
- [ ] Staff login sees only own tenant data (tenant isolation: a second test tenant cannot see the first one's records).
- [ ] Public booking page: availability shows, booking created.
- [ ] Owner/staff: approve/decline the booking; history shows the decision.
- [ ] In-app notification appears for staff/admin.
- [ ] WhatsApp (only if configured with Meta test number and opted-in test recipients): message delivered or a clear FAILED/UNKNOWN status.
- [ ] Logs: open Vercel runtime logs for the smoke window and confirm no raw phone numbers, emails or tokens (section 9). Save a sample.
- [ ] Repeat the full checklist after WP-09 merges (final rehearsal).

## 8. Backup / restore rehearsal (timed)

Branch backup coverage is **not documented** (verify in the dashboard). Pro projects keep 7 daily backups; PITR is an add-on. Dashboard restores make the project unavailable while they run, so **never rehearse a restore on pilot**. Rehearse on staging only:

1. Put a small set of **test** data on staging (smoke run).
2. Start a timer. Dump staging from a trusted machine (owner laptop or a manual job), using the session pooler URL:
   `pg_dump --format=custom --no-owner --schema=public --schema=private "$STAGING_DATABASE_URL" -f staging.dump`
   (`private` holds `resolve_whatsapp_tenant_id`; privileges are kept on purpose because the migrations set grants.)
   (or `supabase db dump` for schema + `--data-only`.) Record time and file size. Store the file encrypted; delete it after the rehearsal.
3. Create a throwaway persistent branch `restore-test` (no data).
4. Restore: `pg_restore --no-owner --dbname "$RESTORE_TEST_DATABASE_URL" staging.dump`. Record time.
5. Verify: row counts for main tables match, all three queries from section 4 match, and `DATABASE_URL="$RESTORE_TEST_DATABASE_URL" npx prisma migrate status` shows up to date. Run this from a checkout **without** a `.env` file: `prisma.config.ts` loads `.env`, and without the explicit prefix it would use whatever local `.env` points at (possibly pilot).
6. Delete the `restore-test` branch. Record total time (RTO) and the backup age you would lose (RPO).

Also record: where pilot's daily backups are shown in the dashboard and who can trigger a pilot restore (owner only, with approval).

## 9. Logs and log masking

- App code logs through `logError` in `src/infrastructure/log-redaction.ts`. It masks emails (`a***@domain`), phone numbers (`***67`), and redacts tokens, JWTs, `Bearer` headers, secret query params (`access_token`, `hub.verify_token`, …), DB URL passwords and message content. Call sites should still log only ids and error codes. Known limits: any 10–15 digit run in free text (e.g. a millisecond timestamp) is masked like a phone number, and `code=` values in URLs are redacted; customer names are only redacted under content keys (`body`, `templateParameters`, `notes`).
- Prisma CLI output in the workflow can show the DB host; that is not a secret. GitHub masks secret values in logs.
- Retention: Vercel runtime logs: Hobby 1 hour, Pro 1 day (30 days with Observability Plus). Log drains need Vercel Pro. Supabase log retention per plan: **(verify)** in the dashboard. For incident evidence, export the relevant logs right away.
- Where to look: Vercel → Project → Logs (app errors, `notification_delivery_unknown`, `whatsapp_provider_*`); Supabase → Logs (Postgres, Auth, API).
- Manual check after incidents: `notification` rows in `UNKNOWN`/`PENDING` state must be reconciled by hand (no automatic retry).

## 10. Uptime check

No new dependency. Pick one:

- **Default:** a GitHub Actions scheduled workflow that `curl`s the staging and pilot home pages every 15 minutes and fails on non-2xx (GitHub emails the owner on failure). Limits: minimum 5-minute interval, UTC, can run late; scheduled workflows are disabled after 60 days without repo activity on public repos. This workflow is **not** added yet; ask an agent to draft it if wanted.
- An external monitor (UptimeRobot or similar) is a **new provider** and needs owner approval and `docs/AI_TOOLING.md` intake first.

## 11. Owners

| Area | Owner |
|---|---|
| Env changes, secrets, branch creation, migrations, deploys | Owner |
| Incident response, rollback decision | Owner |
| Log retention / export | Owner |
| Support contact for pilot salons | Owner |

## 12. Evidence log (fill in)

| Date | Step | Commit | Run / URL | Duration | Result | By |
|---|---|---|---|---|---|---|
| | Branch created | | | | | |
| | First migrate (deploy) | | | | | |
| | Drift check | | | | | |
| | RLS parity | | | | | |
| | Auth redirect test | | | | | |
| | Smoke checklist | | | | | |
| | Backup/restore rehearsal | | | | | |
| | Final rehearsal after WP-09 | | | | | |

## Sources (checked 2026-11-04)

- Supabase branching: https://supabase.com/docs/guides/deployment/branching/working-with-branches, https://supabase.com/docs/guides/deployment/branching/github-integration, https://supabase.com/docs/guides/deployment/branching/pricing
- Supabase connections: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase backups: https://supabase.com/docs/guides/platform/backups
- Supabase redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Vercel environments and env vars: https://vercel.com/docs/deployments/environments, https://vercel.com/docs/environment-variables
- Vercel logs and drains: https://vercel.com/docs/logs/runtime, https://vercel.com/docs/drains
- Prisma 7 config: https://www.prisma.io/docs/orm/reference/prisma-config-reference
- GitHub scheduled workflows: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
