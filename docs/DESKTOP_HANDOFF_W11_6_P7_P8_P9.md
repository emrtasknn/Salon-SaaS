# Desktop Handoff — W11.6, P7, P8, P9

Status: prepared on 2026-11-01. This is the minimal owner/operator checklist after the repository work and CI preparation.

## Already prepared in GitHub PRs

- PR #121 — W11.6 C3 decision record and source/migration audit findings.
- PR #122 — P7 pilot acceptance checklist; guest-booking product decision correctly marked pending explicit confirmation.
- PR #123 — PostgreSQL-backed W11.6 webhook routing/security integration tests.
- PR #124 — P8 production-readiness gate, P9 MVP-closure gate, roadmap reconciliation, and this handoff.

Do not merge any PR until you have reviewed the diff and CI. Do not deploy production.

## Important local environment boundary

The existing local `DATABASE_URL` has historically pointed to the Salon-SaaS Pilot Supabase project, which contains real pilot records and is labeled production.

- Do not run `npm test`, integration tests, Prisma migrations, seed scripts, cleanup scripts, or ad hoc write SQL against that URL.
- The PostgreSQL integration tests are run by GitHub Actions against its isolated PostgreSQL 17 service.
- Do not change the current environment URLs as part of this handoff.
- For browser smoke tests against the existing Pilot project, use only the dedicated synthetic test tenant `randevun-test-2026` and synthetic records. Do not touch any other tenant.
- Do not delete the existing synthetic appointment or the `UNKNOWN` NotificationDelivery row.

## Step 1 — Review and merge documentation/test PRs

For each PR, verify the latest commit and completed green CI:
1. #121 W11.6 decision/audit record.
2. #122 P7 acceptance checklist.
3. #123 W11.6 PostgreSQL integration tests.
4. #124 P8/P9 checklists and roadmap updates.

Merge only after your own review and explicit decision. Merging these PRs does not deploy the application or apply a migration to Pilot Supabase.

## Step 2 — Confirm product decision

The guest-booking experience was not unambiguously selected in the conversation. Confirm one MVP rule before P7 closure:
- guest booking without a customer account;
- mandatory customer account; or
- optional account (guest booking plus optional registration).

Do not treat the current UI behavior as approval.

## Step 3 — Read-only Pilot Supabase inspection

Use Supabase SQL Editor in read-only mode. Do not run migrations or updates.

Check whether the two expected migrations are recorded:

```sql
SELECT migration_name, finished_at, rolled_back_at
FROM public."_prisma_migrations"
WHERE migration_name IN (
  '20261006180000_notification_delivery',
  '20261006190000_whatsapp_integration'
)
ORDER BY migration_name;
```

Check the live resolver function metadata:

```sql
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config,
  p.proacl AS function_acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private'
  AND p.proname = 'resolve_whatsapp_tenant_id';
```

Check forced RLS:

```sql
SELECT
  c.relname,
  c.relrowsecurity,
  c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('WhatsAppIntegration', 'NotificationDelivery')
ORDER BY c.relname;
```

Expected: both migrations recorded; resolver exists, is SECURITY DEFINER, has an empty search_path, and has no PUBLIC EXECUTE grant; both tables have RLS enabled and forced.

The SQL Editor's current role is not necessarily the application's runtime role. Do not infer runtime permissions from the SQL Editor session. If the live catalog differs from the repository/CI expectation, stop and report the exact difference; do not patch the database ad hoc.

## Step 4 — Resolve the existing UNKNOWN delivery safely

- Inspect the exact synthetic appointment and both CREATED delivery rows read-only.
- Identify the recipient profile of the UNKNOWN row without copying phone/email into chat or repository files.
- Inspect redacted local application logs and Meta test-app logs for the same timestamp.
- Determine whether Meta accepted the message.
- Do not resend, reset status, or alter attemptCount on that row.
- If the provider outcome cannot be proven, leave it UNKNOWN and document it as unresolved.

A fresh controlled test, if needed, must use a newly created synthetic appointment and only explicitly opted-in Meta test recipients.

## Step 5 — Complete P7 manual acceptance

Use `docs/P7_PILOT_ACCEPTANCE_CHECKLIST.md` and the PWA device checks:

- Public booking in a logged-out/private browser using the approved customer-account model.
- Verify appointment appears under the test tenant and is PENDING.
- Confirm one synthetic appointment.
- Reject a separate synthetic appointment.
- Verify lifecycle state remains correct even if notification delivery fails.
- Complete the staff workflow on a real mobile device/PWA and record device/browser/OS.
- Verify only the intended test recipients receive messages.

Do not repeat previously accepted W11.4/P6 tests unless a relevant code/configuration regression exists.

## Step 6 — W11.6 real-provider validation

After PR #123 is reviewed/merged and live catalog checks pass:
- Use the Meta test environment only.
- Generate a fresh synthetic appointment/delivery with an opted-in test recipient.
- Confirm providerMessageId is persisted.
- Confirm the signed Meta webhook reaches the intended callback environment.
- Verify SENT/DELIVERED/FAILED status update for that tenant only.
- Verify the other synthetic tenant's delivery remains unchanged.
- READ remains a no-op.
- Do not use a production customer or production sender.

If the webhook cannot reach the local app, do not expose a temporary public tunnel or deploy ad hoc. Record BLOCKED and schedule a properly reviewed staging endpoint.

## Step 7 — P8 / P9 owner-only gates

P8 cannot close until P7 passes, branch protection is enforced, environment/secrets/backup/restore/monitoring/staging checks are evidenced, and the Meta sender permission gate is resolved.

P9 cannot close until P7 and P8 are accepted, MVP scope/product decisions are explicit, functional/security criteria have evidence, deferred scope is documented, and you explicitly approve MVP closure.

Neither phase authorizes production deployment. Production deployment always requires a separate explicit approval after reviewing the exact release commit, target environment, migration plan, and rollback plan.

## Evidence format

Record only scenario ID, timestamp, non-secret environment label, synthetic tenant label, actor role, expected/observed result, persisted status, redacted provider reference, PASS/FAIL/BLOCKED, and deviation.

Never paste tokens, passwords, database URLs, phone numbers, customer emails, app secrets, or webhook secrets into chat or repository evidence.
