# P8 — Production Readiness Gate

Status: **BLOCKED / NOT APPROVED**. This document defines the evidence required for production readiness. It is not a deployment authorization.

## Purpose

Establish that the application, infrastructure, integrations, security controls, operational processes, and release artifacts are ready for a controlled production release. P8 is a readiness review, not a production deployment.

## Non-negotiable boundaries

- No production deployment without a separate, explicit owner approval.
- No production database migration or data mutation as part of this checklist.
- Preserve the existing Salon-SaaS Pilot database and its real tenant/customer/appointment records.
- Use isolated staging/test infrastructure and synthetic records for rehearsals.
- Never send production WhatsApp messages during readiness testing.
- Do not retry or reset `NotificationDelivery.UNKNOWN` automatically. Reconcile provider evidence first.
- A green CI run alone does not establish production readiness.

## Current known blockers

1. **P7 pilot acceptance is OPEN.** The end-to-end pilot journey, real-device PWA evidence, and external integration evidence must be completed first.
2. **W11.5 is PARTIAL PASS.** Real CREATED/CONFIRMED device evidence and provider hardening exist, but REJECTED delivery, controlled provider failure, explicit duplicate/idempotency repetition, and shared-sender permission remain open.
3. **W11.6 is under implementation/security verification.** C3 routing approval is recorded; PostgreSQL-backed integration coverage is being added. Live Supabase function ownership/grants/migration state and Meta webhook delivery remain unverified.
4. **Meta shared-sender permission is unresolved.** The public policy review does not establish permission to use one shared sender for unrelated tenant businesses. No production use until applicable Meta/provider terms and account configuration are validated.
5. **Main branch protection is not fully enforced.** The repository branch endpoint reports the branch as protected but protection/status-check enforcement is disabled. Configure required checks in GitHub settings and verify the effective rules.
6. **Production environment evidence is absent.** No independent inventory/review of production secrets, Supabase roles/configuration, auth redirect configuration, domains, monitoring, backup/restore, or staging release evidence is recorded here.
7. **Guest booking product decision needs explicit confirmation.** P7 checklist must not treat guest booking as an approved product decision until the owner explicitly confirms it.

## Readiness workstreams

### A. Release governance and source control

- [ ] Main branch protection/ruleset is enabled and verified from GitHub settings.
- [ ] Required CI checks are enforced for pull requests and direct pushes are restricted appropriately.
- [ ] CODEOWNERS/reviewer expectations are documented where applicable.
- [ ] No unreviewed or unmerged release-critical code remains.
- [ ] Release commit/tag and source provenance are recorded.
- [ ] All relevant PRs have successful CI and human review.
- [ ] No PR is merged automatically without the owner's explicit approval.

### B. Application quality

- [ ] `npm ci` succeeds from a clean checkout.
- [ ] Prisma client generation succeeds.
- [ ] Prisma migrations deploy successfully against an isolated staging database.
- [ ] Lint, typecheck, unit tests, PostgreSQL integration tests, and production build pass.
- [ ] Booking concurrency, invalid transitions, timezone, duration/buffer, and availability boundaries are covered.
- [ ] Public booking is server-authoritative and fails closed on invalid tenant/resource identifiers.
- [ ] No critical/high severity unresolved defect remains.
- [ ] Production bundle and browser-visible assets contain no secrets.

### C. Database, migration, and recovery

- [ ] Staging schema matches the reviewed Prisma schema and migration history.
- [ ] Migration drift is checked without applying changes to the Pilot/production database.
- [ ] Each release migration has a reviewed forward plan and recovery/rollback strategy.
- [ ] A backup is available and a restore rehearsal has been completed in isolated infrastructure.
- [ ] Database connection role and privileges are least-privilege and documented.
- [ ] RLS is enabled/forced on tenant-owned tables as intended.
- [ ] RLS/security regression passes against PostgreSQL.
- [ ] Transaction-local tenant context is proven not to leak across pooled connections.
- [ ] No production data cleanup/reset is required for release.

### D. Authentication, authorization, and tenant isolation

- [ ] Trusted tenant resolution uses server-verified identity metadata and membership.
- [ ] Client-supplied tenant identifiers never authorize access.
- [ ] SUPER_ADMIN/TENANT_ADMIN/STAFF/CUSTOMER permissions are tested.
- [ ] Cross-tenant read, mutation, direct-ID, public booking, notification, and webhook scenarios pass.
- [ ] Inactive membership/staff and missing tenant context fail closed.
- [ ] Supabase Auth redirect URLs, callback URLs, email flows, and session behavior are validated for the production domain.
- [ ] Service-role credentials remain server-only and are not used by browser code.

### E. WhatsApp and external integrations

- [ ] W11.5 exit criteria are evidenced in an isolated approved Meta environment.
- [ ] CREATED, CONFIRMED, and REJECTED routing is validated with opted-in test recipients.
- [ ] Provider acceptance, message ID persistence, failure classification, and idempotency are validated.
- [ ] UNKNOWN remains non-retryable until provider outcome is reconciled.
- [ ] W11.6 resolver ownership, SECURITY DEFINER posture, search_path, execute grants, active integration filtering, RLS, and tenant-scoped mutation are verified on the intended database.
- [ ] Real signed Meta webhook delivery validates status persistence in the isolated test environment.
- [ ] Meta shared-sender permission is explicitly confirmed for the actual intended business model, or architecture is revisited before production.
- [ ] Template approval, language, parameter mapping, opt-in, business identity, and opt-out handling are validated.
- [ ] No production customer is used as a test recipient.

### F. PWA and device compatibility

- [ ] P7 real-device acceptance is complete.
- [ ] Supported mobile browser/device/OS matrix is documented.
- [ ] Installability, standalone launch, navigation, session persistence, and core staff workflow are validated.
- [ ] Responsive checks cover 320, 390, 414, 768, 1024, and 1280+ widths.
- [ ] Service worker update/cache behavior does not serve stale or unsafe business state.
- [ ] Offline behavior is clearly bounded; no offline business mutation is implied without a separately approved design.
- [ ] Web Push is either implemented and accepted as an MVP requirement, or explicitly deferred by product decision. Do not silently add subscription schema/provider behavior.

### G. Operations, privacy, and support

- [ ] Production logs are structured and redact credentials, tokens, phone numbers, and unnecessary PII.
- [ ] Monitoring/alerts cover application errors, database health, webhook failures, and notification delivery outcomes.
- [ ] Webhook retry/duplicate behavior and failure visibility are understood.
- [ ] UNKNOWN/PENDING delivery reconciliation is an operator-controlled documented process.
- [ ] Rate limiting/abuse controls exist for public booking and authentication surfaces.
- [ ] Data retention, backup retention, deletion/export, and incident response owners are documented.
- [ ] Privacy notice, terms, consent/opt-in language, and applicable Turkish KVKK obligations are reviewed by the responsible owner/advisor. This checklist is not legal advice or a compliance certification.
- [ ] Support/escalation path and rollback decision owner are identified.

### H. Staging and release rehearsal

- [ ] Production-like staging environment is isolated from the Pilot/production database and credentials.
- [ ] Clean deployment rehearsal succeeds.
- [ ] Staging smoke test completes the full owner → staff → public booking → decision → customer history journey.
- [ ] Staging Meta tests use only opted-in test recipients and approved non-production configuration.
- [ ] Backup/restore and rollback rehearsal evidence is recorded.
- [ ] Release notes, known limitations, and operator runbook are prepared.
- [ ] Go/no-go review records all residual risks and explicit owner decision.

## P8 exit rule

P8 may be marked READY only when all applicable sections have evidence, no release-blocking issue remains, P7 is accepted, external integration gates are cleared, and the owner explicitly signs off the readiness review.

**P8 READY is not permission to deploy.** Production deployment requires a separate explicit approval after the release plan, target environment, migration plan, and rollback plan are presented.

## Deployment authorization boundary

The only authorized sequence is:

1. Release plan and exact commit identified.
2. Owner reviews target environment, migration impact, secrets/configuration, monitoring, and rollback.
3. Owner explicitly approves production deployment.
4. Operator performs the approved deployment.
5. Post-deployment smoke and monitoring are recorded.
6. Owner accepts or rolls back based on evidence.

No step above is authorized by this document alone.
