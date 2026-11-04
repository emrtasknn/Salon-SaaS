# Task — WP-2c: Status-webhook tenant routing under the shared WhatsApp sender

Status: **Approved and implemented (2026-11-04), pending CI.** Owner approved Option A, the non-unique `providerMessageId` index and HTTP 200 + log for unresolved statuses. Migration `20261105140000_whatsapp_delivery_tenant_resolver` (not applied anywhere). Original proposal text below. The salon-saas-reviewer tenant-isolation review (2026-11-04) raised two blocking items: RLS proof under a non-bypass role, and Supabase grants/owner. Both are folded into the migration outline, test plan and acceptance criteria below.

## Objective
Meta status webhooks (`sent` / `delivered` / `failed`) for a message sent through the single shared platform number update the `NotificationDelivery` row of the tenant that sent it. Every other tenant's data stays untouched, and anything ambiguous fails closed.

## Risk class
**C3.** This changes the W11.6-approved webhook routing (`phone_number_id → WhatsAppIntegration → tenantId`), adds a new pre-tenant lookup, and needs a migration (SQL function + index). Work stops after this plan until the owner approves it.

## Context
- Owner decision 2026-11-04: one shared Meta sender for MVP (ADR-042 addendum, `docs/tasks/WP-02b.md`). Production use is still gated on Meta shared-sender terms (`docs/P8_PRODUCTION_READINESS_CHECKLIST.md` item 4). This WP does not clear that gate.
- `docs/W11.6_WHATSAPP_TENANT_ROUTING_C3.md` (approved 2026-11-01). Its rules include: "Provider message ID is never searched before trusted tenant resolution" and "Do not make `providerMessageId` globally unique".
- ADR-042 "Known gaps" item 2 and `docs/ROADMAP.md:70` record this gap.
- The brief mentioned `docs/tasks/WP-02.md`; it does not exist in the repo. The shared-sender decision lives in ADR-042 and WP-02b.

### Current behaviour (verified in code)
- Outbound: one provider instance per process, configured from env `WHATSAPP_PHONE_NUMBER_ID` (`src/app/notification-runtime.ts:11`). Every tenant sends from that number. The request body has no correlation field (`src/infrastructure/notifications.ts:73-84`).
- The delivery row is claimed **before** the send and `markSent` stores the returned `wamid` as `providerMessageId` (`src/persistence/prisma-notification.ts:124-128`).
- Inbound: `route.ts` verifies `X-Hub-Signature-256` on the raw body, parses statuses, groups them by `metadata.phone_number_id` and calls `private.resolve_whatsapp_tenant_id(phone)` (`src/app/api/webhooks/whatsapp/route.ts:36-60`).
- That resolver is `SECURITY DEFINER`, `search_path = ''`, filters `provider = 'META_WHATSAPP' AND status = 'ACTIVE'`, `LIMIT 1`; EXECUTE is revoked from PUBLIC and granted to `postgres` (`prisma/migrations/20261006190000_whatsapp_integration/migration.sql`).
- `WhatsAppIntegration` is unique on `(provider, phoneNumberId)` (`prisma/schema.prisma:205`), so the shared number maps to **one** tenant. Statuses for every other tenant resolve to that tenant, the tenant-filtered `UPDATE` matches 0 rows, and their rows stay `SENT`. No cross-tenant write happens today; the failure is data staleness only.
- Updates are tenant-filtered, monotonic (`DELIVERED`/`FAILED` are never left), `read` is a no-op (`src/persistence/prisma-whatsapp-webhook.ts:20-38`).
- `NotificationDelivery` has ENABLE + FORCE RLS and **no index on `providerMessageId`** (`schema.prisma:188-190`).

## Meta payload fields available for correlation
See "Research findings" below (salon-saas-research, sourced). Summary of what matters for the design:
- `entry[].changes[].value.metadata.phone_number_id` — the shared number. Identifies the sender, not the tenant.
- `statuses[].id` — the `wamid` returned by the Send API and already stored as `providerMessageId`.
- `statuses[].recipient_id` — the customer/staff phone. Not unique per tenant (one person can be a customer of two salons), so **not** a routing key.
- `statuses[].biz_opaque_callback_data` — an arbitrary string we may attach on send and Meta echoes back in status webhooks (see findings for which statuses and limits).
- `conversation` / `pricing` — billing data, no tenant meaning.

### Research findings (salon-saas-research, 2026-11-04)
- **Confirmed:** `metadata` carries `display_phone_number` and `phone_number_id` (sending-line ids, not tenant ids). `statuses[]` carries `id` (wamid), `status` (sent/delivered/read/played/failed), `timestamp`, `recipient_id`, `conversation`, `pricing`, `errors` (failed only). Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
- **Confirmed:** the send-response `messages[0].id` is the id that appears in the sent/delivered/read webhooks. Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages/
- **Confirmed:** when a message is read, Meta may send no separate `delivered` webhook. Because W11.6 makes `read` a no-op, such rows stay `SENT`. This is an existing W11.6 behaviour, not caused by this WP (listed under Risks).
- **Confirmed:** Meta retries non-200 responses for up to 7 days and retries can produce duplicate notifications. Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- **Confirmed:** `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(App Secret, payload). It proves origin, not tenant. Source: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- **Partly confirmed:** `biz_opaque_callback_data` is echoed on status objects "only if set", max 512 chars (changelog 2024-01-26). **Unconfirmed:** which statuses carry it (especially `failed`) and whether template messages behave the same as session messages. Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
- **Unconfirmed:** that a wamid is globally unique and permanent (docs only say "WhatsApp message ID"; a search snippet says up to 128 chars). This is why every option below fails closed on a match in more than one tenant.

## Options

### Option A — Platform resolver `wamid → tenantId` (SECURITY DEFINER function)
New function `private.resolve_whatsapp_delivery_tenant_id(p_provider_message_id TEXT) RETURNS TEXT`:
- `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`, schema-qualified table names.
- Reads `public."NotificationDelivery"` where `"channel" = 'WHATSAPP' AND "providerMessageId" = p_provider_message_id`.
- Returns `tenantId` **only if exactly one distinct tenant matches** (`HAVING count(DISTINCT "tenantId") = 1`); otherwise `NULL`. No `LIMIT 1`.
- Rejects input that is NULL, empty, or longer than a fixed cap (e.g. 256 chars).
- Returns only the tenant id: no delivery id, status, phone or appointment data.
- `REVOKE ALL ... FROM PUBLIC`; `GRANT EXECUTE` only to the runtime role (same pattern as the existing resolver).

Route change (later implementation step, not now):
1. Signature check and parse — unchanged.
2. If `phone_number_id` equals the platform shared sender id (`WHATSAPP_PHONE_NUMBER_ID`, server config), resolve **per status** with the new function, then apply it in `withPrismaTenantContext` with the existing tenant-filtered, monotonic `UPDATE` (see 5 and 6).
3. Any other `phone_number_id` keeps the W11.6 path (future per-tenant numbers).
4. `NULL` → count as unresolved, no mutation, HTTP 200 (so Meta does not retry forever). A NULL on the shared-number path must **not** fall back to `resolve_whatsapp_tenant_id` (that would send it to the pilot tenant).
5. After resolving each status, group the statuses by `tenantId` and apply each group in its own `withPrismaTenantContext` transaction.
6. Add `"channel" = 'WHATSAPP'` to the existing `UPDATE`s so the mutation matches the resolver's filter.

Schema / migration:
- New function only; **no table change**.
- Add a **non-unique** index on `NotificationDelivery("providerMessageId")`. Justification: without a `tenantId` prefix the resolver would scan the whole table on every webhook. W11.6 allows a non-unique index with migration review.
- The `(provider, phoneNumberId)` unique constraint stays as is. The pilot tenant's integration row stays but is no longer used for shared-number routing.

Pros: smallest change; works for messages already sent (rows have `providerMessageId` today); no send-path change; no new table.
Cons:
- It amends three W11.6 statements: "provider message ID is never searched before trusted tenant resolution" (W11.6 security criteria), "the resolver is the only pre-tenant lookup" (audit item 3), and the routing chain itself. After the change, a wamid is searched only by one narrow definer function that returns a tenant id or NULL.
- The trust anchor becomes "the wamid was written by our server from Meta's send response", not "the phone number belongs to a tenant".
- `NotificationDelivery` does not store which sender sent the message. If per-tenant numbers come later, A cannot tell shared-sender wamids from per-tenant ones. The phone-number gate in the route mitigates this; Option B or a later `senderPhoneNumberId` column would fix it fully.
- One tenant with two rows sharing a wamid still resolves, and both rows are updated. This is acceptable: it stays inside one tenant.

### Option B — Platform-scoped routing table
New table `WhatsAppMessageRoute(id, phoneNumberId, providerMessageId, tenantId, notificationDeliveryId, createdAt)`, unique on `(phoneNumberId, providerMessageId)` (scoped to the sender, not global — still needs owner sign-off against the ADR rule).
- Written in the same transaction as `markSent` through a `SECURITY DEFINER` writer `private.record_whatsapp_message_route(...)`, because the row is not readable/writable by tenant RLS.
- RLS ENABLE + FORCE with **no** app-role policies; only the definer functions can touch it.
- The webhook resolver reads this table instead of `NotificationDelivery`.

Pros: explicit routing record scoped to the sender (`phoneNumberId`), so it stays correct if per-tenant numbers are added; the unique key catches a (theoretical) wamid collision at write time; the resolver never touches tenant tables.
Cons: new table, two new definer functions, a write on the hot send path, backfill needed for existing `SENT` rows, retention/cleanup policy needed, more surface to review. Same trust anchor as A.

### Option C — `biz_opaque_callback_data` correlation token
On send, attach `biz_opaque_callback_data = v1.<deliveryId>.<HMAC(server secret, tenantId|deliveryId)>` (no plain tenant id needed). On webhook, verify the token's HMAC, then look up `NotificationDelivery` by `(id = deliveryId)` through a definer function and cross-check `providerMessageId = statuses[].id`.
Pros: routing key is our own signed value, independent of wamid.
Cons: depends on Meta echoing the field on every status we use (see findings); messages sent before the change carry no token, so a fallback (A) is needed anyway; adds a new server secret and send-path change; still needs a definer lookup by delivery id.

### Option D — Many integrations per shared number, fan out
Change the unique constraint to `(provider, phoneNumberId, tenantId)`, register the shared number for every tenant, and try the tenant-filtered `UPDATE` in each tenant's context.
Pros: keeps the W11.6 rule literally (wamid only searched inside a tenant context).
Cons: N transactions per status event; every new tenant needs an integration row; the existing resolver's `LIMIT 1` must be rewritten; an onboarding mistake silently drops routing; "exactly one match" cannot be enforced without the cross-tenant knowledge this option avoids. Worst scaling, most schema churn.

## Recommendation
**Option A**, with these guards:
1. Used only when `phone_number_id` equals the configured platform sender; other numbers keep W11.6 routing.
2. Exactly-one-tenant match, otherwise fail closed.
3. Function returns only `tenantId`; the mutation stays in the existing tenant-scoped, monotonic `UPDATE` under FORCE RLS (plus a channel filter).
4. Non-unique index on `providerMessageId`; no global uniqueness.
5. Explicit BYPASSRLS owner, narrow grants, and a read-only live check before rollout.
6. Option C may be added later as defence in depth if research confirms Meta echoes the token on `sent`/`delivered`/`failed`; it is not needed for correctness.

Why not B (for now): it adds a new table, a second definer function, a hot-path write and a backfill. Its main advantage, sender scoping, only matters once per-tenant numbers exist, and those are out of MVP scope. Revisit B if they come. Why not D: it scales per tenant and depends on onboarding being perfect.

Owner decisions needed:
1. Approve amending the W11.6 rule to allow this one wamid-keyed pre-tenant lookup (Option A) — or pick B/C/D.
2. Approve the non-unique index on `NotificationDelivery.providerMessageId`.
3. Confirm unresolved statuses return HTTP 200 (logged as unresolved) rather than 4xx/5xx. Trade-off: a `failed` webhook that arrives before `markSent` commits the wamid, or after `markSent` itself failed, resolves to NULL and is lost. The row then stays `SENT`/`UNKNOWN`. Returning 5xx would make Meta retry, but would also cause retries for wamids that are truly unknown.

## Scope
In: one migration (function + index), route branch for the shared sender, unit + integration tests, W11.6 / ADR-042 doc amendments.
Out: Meta subscription/deploy changes, production deployment, READ state, appointment state machine, global `providerMessageId` uniqueness, sender-per-tenant onboarding, Meta-terms gate.

## Migration outline (proposal only — do not write or apply yet)
1. Index: plain `@@index([providerMessageId])` in `schema.prisma` (NULLs in a btree are harmless). This avoids the drift a SQL-only partial index would cause in `prisma migrate diff`. Expected size at pilot scale is a few thousand rows, so a normal `CREATE INDEX` (brief write lock) is acceptable; use `CONCURRENTLY` in a separate migration if the table is large at rollout. W11.6 asks for a measured need: the justification is that without a `tenantId` prefix every webhook would scan the whole table.
2. `CREATE OR REPLACE FUNCTION private.resolve_whatsapp_delivery_tenant_id(p_provider_message_id TEXT) RETURNS TEXT LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = ''` — body: `SELECT min("tenantId") FROM public."NotificationDelivery" WHERE "channel" = 'WHATSAPP' AND "providerMessageId" = p_provider_message_id AND length(p_provider_message_id) BETWEEN 1 AND 256 HAVING count(DISTINCT "tenantId") = 1`.
   - Semantics: with no `GROUP BY` the aggregate forms one group. A false `HAVING` (0 or ≥2 tenants) returns zero rows, which a scalar SQL function returns as NULL. `STRICT` returns NULL for NULL input.
3. `ALTER FUNCTION ... OWNER TO <role with BYPASSRLS>` (explicit; with FORCE RLS a non-bypass owner sees zero rows). `REVOKE ALL ON FUNCTION ... FROM PUBLIC` plus `anon`, `authenticated` and `service_role` (inside a `DO` block that checks the roles exist, because CI PostgreSQL has no Supabase roles). `GRANT EXECUTE ... TO` the runtime role only (today `postgres`, mirroring the existing resolver).
4. No change to `WhatsAppIntegration`, its unique index, or any RLS policy.
5. Rollback: `DROP FUNCTION`, `DROP INDEX`; no data migration.

## Test plan
Unit (`npx vitest run`, `DATABASE_URL` unset):
- Route: shared-number statuses resolve per status and are grouped by tenant (one apply call per tenant); non-shared numbers use the W11.6 resolver; a NULL on the shared path does **not** call the W11.6 resolver; NULL tenant → no apply call, counted unresolved; invalid signature 403; malformed JSON 400.
- Parser: unchanged behaviour; optional `biz_opaque_callback_data` ignored unless Option C is approved.

Integration (CI only, isolated PostgreSQL 17; extend `src/persistence/prisma-whatsapp-webhook.integration.test.ts`):
- CI connects as superuser, which skips RLS. Tests 1, 2 and 5 must therefore run the `UPDATE` and the cross-tenant read under `SET ROLE` with a NOLOGIN role that has no BYPASSRLS (the pattern in `src/persistence/rls-tenant-isolation.integration.test.ts:81,399`). Otherwise they only prove the `WHERE "tenantId"` filter.
- Use realistic distinct wamids in fixtures. The mock provider's `mock-N` ids (`src/infrastructure/notifications.ts:18`) repeat across tenants, so mock-sent rows fail closed by design.
1. **Two tenants, one number:** tenants A and B each have a `SENT` WhatsApp delivery with different wamids. A `delivered` webhook for B's wamid sets B to `DELIVERED`; A unchanged. Repeat in reverse.
2. **Collision fails closed:** the same wamid in A and B → resolver returns NULL, neither row changes.
3. **Unknown wamid** → NULL, no mutation.
4. **Function metadata:** `prosecdef = true`, `proisstrict = true`, `proconfig` contains `search_path=`, no PUBLIC EXECUTE, return type `text`; the owner has `rolbypassrls` or is superuser; `has_function_privilege` is false for `anon`/`authenticated` when those roles exist.
5. **RLS still forced** on `NotificationDelivery` and `WhatsAppIntegration`; a tenant-A context cannot read B's row after routing.
6. **Monotonic:** delayed `sent` after `DELIVERED`, `failed` after `DELIVERED`, duplicate events, `read` — no regression.
7. **Non-shared number** still routes through `WhatsAppIntegration` (regression for W11.6).
8. **Input guard:** empty and oversized wamid → NULL.

## Risks
- **Trust anchor shift.** Routing trusts that only our server writes `providerMessageId`. Any future code path that lets a client set `providerMessageId` would let an attacker who can also forge Meta-signed webhooks redirect status updates. Mitigation: keep `providerMessageId` server-written only (it is today); the webhook still requires the Meta app-secret HMAC.
- **Information leak via the function.** It reveals "which tenant owns wamid X" to anyone with EXECUTE. Mitigation: EXECUTE only for the runtime role; wamids are not guessable; no other fields returned.
- **Definer owner and FORCE RLS.** With FORCE RLS the function owner must have `BYPASSRLS` (or be superuser) or the function sees zero rows. CI runs as `postgres` superuser, which would hide this. Covered by the explicit owner, test 4 and the pre-rollout gate.
- **Supabase default grants.** Revoking from PUBLIC alone does not remove grants that Supabase default privileges may give `anon`/`authenticated`/`service_role`. Covered by migration step 3 and test 4.
- **Status before wamid is stored.** See owner decision 3: an early `failed` webhook can be lost.
- **Shared-sender id from env.** If `WHATSAPP_PHONE_NUMBER_ID` is wrong, shared statuses fall back to W11.6 routing and stay stale (fail closed, not cross-tenant).
- **Read without delivered.** Meta may skip `delivered` when a message is read; with `read` a no-op (W11.6) those rows stay `SENT`. Out of scope here; a separate decision could map `read` → `DELIVERED` when the row is still `SENT`.
- **Duplicates / retries.** Meta retries for up to 7 days; the monotonic `UPDATE` already makes repeats harmless.
- **Meta terms gate** remains open; this WP only fixes routing for pilot use.

## Acceptance criteria
- [ ] Two-tenant integration test proves B's status updates only B, and the collision case updates nobody.
- [ ] Existing W11.6 tests still pass; RLS ENABLE/FORCE unchanged.
- [ ] No global uniqueness on `providerMessageId`; no change to `WhatsAppIntegration` constraints.
- [ ] Lint, typecheck, unit tests pass; integration coverage via CI.
- [ ] Isolation tests run under a non-BYPASSRLS role, not only as superuser.
- [ ] **Pre-rollout gate (read-only, owner-approved):** on Pilot, check the new function's `pg_proc.proowner` → `rolbypassrls`, its EXECUTE grants, and the live runtime role. This carries over the W11.6 "Remaining live-environment checks" to the new function. No rollout until this passes.
- [ ] W11.6 doc (routing chain, security criteria, audit item 3) and ADR-042 gap #2 amended after owner approval.

## Start here
- Code: `src/app/api/webhooks/whatsapp/route.ts`, `src/persistence/prisma-whatsapp-webhook.ts`, `src/infrastructure/meta-whatsapp-webhook.ts`, `src/infrastructure/notifications.ts` (Option C only)
- Docs: `docs/W11.6_WHATSAPP_TENANT_ROUTING_C3.md`, `docs/ADR-042-META-WHATSAPP-CLOUD-API.md`, `docs/RLS_TENANT_ISOLATION.md`
- Tests: `src/persistence/prisma-whatsapp-webhook.integration.test.ts`, `src/infrastructure/meta-whatsapp-webhook.test.ts`

## Constraints
- `AGENTS.md` non-negotiables apply. No local integration tests or migrations while `DATABASE_URL` is set.
- No commit/push/deploy without owner approval.

## Report
`AGENTS.md` Required Report + update `docs/SESSION_HANDOFF.md`.

## Agent log
- 2026-11-04 (salon-saas-database): owner approved (1) Option A, amending the W11.6 rule for this one wamid-keyed pre-tenant lookup; (2) the non-unique index on `NotificationDelivery.providerMessageId`; (3) unresolved statuses return HTTP 200 and are logged. Wrote migration `20261105140000_whatsapp_delivery_tenant_resolver` (index `NotificationDelivery_providerMessageId_idx` + `private.resolve_whatsapp_delivery_tenant_id(TEXT)`, explicit owner `postgres`, EXECUTE only to `postgres`) and `@@index([providerMessageId])` in `schema.prisma`. Not applied; no prisma/SQL run. Open: whether `postgres` has BYPASSRLS on Pilot is unverified (pre-rollout gate; see WP-05 open check).
- 2026-11-04 main session: route + persistence by salon-saas-backend (23 unit tests pass); integration tests 1–8 by salon-saas-qa (CI only). Docs amended: W11.6 step 3 exception, ADR-042 addendum item 2 resolved, `docs/STAGING_RUNBOOK.md` §4.5 pre-rollout BYPASSRLS gate for both resolvers.
