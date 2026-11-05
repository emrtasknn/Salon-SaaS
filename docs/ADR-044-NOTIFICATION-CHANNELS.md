# ADR-044 — MVP Notification Channels: In-App, Web Push, Customer Status Link

## Status

**Accepted — C3** (proposed in #129; accepted by the owner 2026-11-04). The owner resolved all §10 decisions on 2026-11-03 (recommended options accepted). Even then, each phase (§9) ships as its own reviewed PR, and applying any migration to Pilot requires separate explicit approval (P8 gates).

Related: `PROJECT_GOVERNANCE.md` §4 and §12 (C2 scope change, PR #128), ADR-042 (WhatsApp), ADR-043 (PWA-first), `W11_IMPLEMENTATION_PLAN.md` W11.10 / W11.11, P7 (guest booking, Option A).

## 1. Context

The owner-approved MVP scope (2026-11-03) requires appointment notifications through **in-app**, **Web Push**, and **WhatsApp**, and proposes a **customer appointment-status link**.

Current state (inspected on `main` @ `6c62fec`):

- `NotificationService.publish(tenantContext, appointmentId, eventType)` (`src/application/notification-service.ts`) handles one channel, `WHATSAPP`, through a single provider. It is called from `src/app/notification-runtime.ts`.
- `NotificationDelivery` records one row per `(tenantId, appointmentId, eventType, channel, recipientProfileId)`. RLS is enabled and forced.
- `NotificationChannel` = `WHATSAPP` only. `NotificationEventType` = `APPOINTMENT_CREATED | APPOINTMENT_CONFIRMED | APPOINTMENT_REJECTED`.
- Recipients (`src/persistence/prisma-notification.ts`): CREATED → assigned staff + customer; CONFIRMED/REJECTED → customer.
- Guest booking (P7 Option A) creates or reuses a `Profile` keyed by `(tenantId, email)` with **no** `TenantMembership`. So every appointment has a `customerProfileId`, but guests cannot authenticate.
- PWA foundation (manifest link, service worker registration, install prompt) is wired since #134 (WP-03, W11.10); there is no push dependency or push-subscription model yet (W11.11 / WP-09).

## 2. Decision summary

| Channel | Audience in MVP | Persistence | Depends on |
|---|---|---|---|
| WhatsApp | staff + customer (unchanged) | existing `NotificationDelivery` | ADR-042 / W11.5–W11.6 |
| In-app | staff + tenant admin | **none (derived from `Appointment`)**, Option A (§10-1) | — |
| Web Push | staff + tenant admin, installed PWA only | new `PushSubscription` + `NotificationDelivery` channel `WEB_PUSH` | W11.10 PWA foundation, `web-push` dependency |
| Status link | customer (guest) | new `AppointmentAccessToken` (hash only) | trusted slug tenant resolution |

Customers do **not** receive Web Push or in-app notifications in MVP: they have no account and no installed PWA. Their channels are WhatsApp + the status link.

Appointment lifecycle semantics are unchanged. Delivery outcomes never mutate appointment state (ADR-043).

## 3. In-app notifications

**Option A (recommended for MVP), no schema change:** the admin/staff UI shows a "pending requests" badge and a list derived from `Appointment` (`status = PENDING`, tenant-scoped, staff-scoped for STAFF) plus recent status changes from `updatedAt`. It refreshes on navigation/focus and on an incoming Web Push. There is no read/unread state.

**Option B (only if read/unread or a persistent feed is required):** a new table `InAppNotification(id, tenantId, recipientProfileId, appointmentId, eventType, createdAt, readAt?)` with RLS. The idempotency key is `(tenantId, appointmentId, eventType, recipientProfileId)`. It is written by `NotificationService` as channel `IN_APP`, and only the recipient may mark it read.

Why A: smallest safe change, no duplicated state, and Appointment is already authoritative. B can be added later without breaking A.

## 4. Web Push

### 4.1 Proposed model (candidate per ADR-043, not approved)

```prisma
model PushSubscription {
  id            String    @id @default(cuid())
  tenantId      String
  profileId     String
  endpoint      String
  p256dh        String
  auth          String
  userAgent     String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  lastSuccessAt DateTime?
  lastFailureAt DateTime?
  lastSeenAt    DateTime  @default(now())
  failureCount  Int       @default(0)
  revokedAt     DateTime?

  tenant  Tenant  @relation(fields: [tenantId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  profile Profile @relation(fields: [tenantId, profileId], references: [tenantId, id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([tenantId, id])
  @@unique([tenantId, endpoint])
  @@index([tenantId, profileId, revokedAt])
}
```

Amended 2026-11-04 (WP-09, migration `20261105130000_web_push_subscription`): added `lastFailureAt` (last transient/gone failure) and `lastSeenAt` (refreshed on every subscribe/re-subscribe). DB CHECKs, mirrored by server-side validation after stripping `=` padding: `endpoint` starts with `https://` and is ≤ 2048 chars; `p256dh` matches `^B[A-Za-z0-9_-]{86}$` (65-byte uncompressed P-256 point, unpadded base64url); `auth` matches `^[A-Za-z0-9_-]{22}$` (16 bytes); `userAgent` ≤ 256 chars; `failureCount` ≥ 0.

### 4.2 ADR-043 constraints, resolved

| Constraint | Resolution |
|---|---|
| Tenant ownership | `tenantId` from trusted `TenantContext` only, the composite FK to `Profile`, and RLS `ENABLE` + `FORCE` with the standard `app.tenant_id` policy. |
| Profile ownership | `profileId` is derived server-side from the authenticated membership (ADR-033). The client sends only the browser `PushSubscription` JSON. |
| Endpoint / keys handling | `endpoint`, `p256dh` and `auth` are stored server-side and never returned to clients or logged. VAPID private key is a server env secret only. Endpoint URLs are validated (https only). |
| Multiple devices | Many rows per profile; one row per `(tenantId, endpoint)`. Re-subscribing the same endpoint under another profile in the same tenant reassigns it (latest authenticated user owns the device). |
| Revocation / expiry | Push service `404`/`410` → set `revokedAt`. Logout → client `unsubscribe()` + server revoke for that profile/endpoint. Other transient errors → `failureCount++`, revoke after 5 consecutive failures (§10-6). |
| Staff deactivation | Authoritative **send-time** check: deliver only if the profile currently has a membership in the tenant and, for STAFF, `Staff.status = ACTIVE`. Optional cleanup revokes subscriptions on deactivation. |
| Cleanup | Revoked rows are purged after 30 days by an explicit, tenant-scoped maintenance job (separate approval; not part of MVP critical path). |
| RLS / server authz | Subscribe/unsubscribe are server actions that require an authenticated STAFF/TENANT_ADMIN identity in the resolved tenant. No client tenant/profile IDs are trusted. |
| Idempotency / delivery | One `NotificationDelivery` row per `(appointment, event, WEB_PUSH, recipientProfile)`, the existing unique key, unchanged. Fan-out to all active devices; `SENT` if ≥1 device accepted, `FAILED` if none, `UNKNOWN` on ambiguous error. Amended 2026-11-04 (owner, WP-09): when the recipient has **no active subscription**, no `WEB_PUSH` delivery row is created (the recipient is skipped, not recorded as `FAILED`). |

### 4.3 Payload and permission UX

- Payload is minimal and contains no customer PII beyond what the recipient already sees in the app: event label, service, time, and a role-appropriate relative deep link (`/staff/appointments` for STAFF, `/admin/calendar` for TENANT_ADMIN; both pages exist today). The link target re-checks authorization.
- The permission prompt appears only after an explicit user tap ("Enable notifications") inside the installed PWA. iOS requires the app to be installed to the home screen.

### 4.4 Routing (proposed)

- `APPOINTMENT_CREATED` → assigned staff profile + all TENANT_ADMIN profiles of the tenant (§10-3), deduplicated when one profile has both roles.
- `APPOINTMENT_CONFIRMED` / `REJECTED` → no Web Push (customer-only events today).

### 4.5 New dependency

`web-push` (npm, MPL-2.0 — corrected 2026-11-04; owner accepted it as an unmodified dependency) handles VAPID signing and RFC 8291 payload encryption. Implementing this ourselves is error-prone, so a vetted library is justified. Owner-approved 2026-11-03 (§10-2) per AGENTS.md rule 6; it is added only in the phase 3 PR.

## 5. Customer status link

### 5.1 Proposed model

```prisma
model AppointmentAccessToken {
  id            String    @id @default(cuid())
  tenantId      String
  appointmentId String
  tokenHash     String
  expiresAt     DateTime
  revokedAt     DateTime?
  createdAt     DateTime  @default(now())

  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  appointment Appointment @relation(fields: [tenantId, appointmentId], references: [tenantId, id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([tenantId, id])
  @@unique([tenantId, appointmentId])
  @@unique([tenantId, tokenHash])
}
```

### 5.2 Rules

- Token: 32 random bytes (CSPRNG), base64url. Only the SHA-256 hash is stored. The plaintext exists only in the booking response and in outgoing messages.
- URL: `/{tenantSlug}/randevu/{token}` (new page under the existing `src/app/[slug]/` route). The tenant is resolved through the existing trusted slug resolution, then the token is looked up **inside** that tenant context under RLS. No RLS bypass and no cross-tenant lookup.
- Created in the same transaction as the guest appointment (`prisma-public-booking.ts`). This touches the booking persistence path but **not** booking semantics, availability, or status transitions.
- Expiry: `endAt + 7 days` (§10-4). Expired, revoked, or unknown tokens all return the same generic "link invalid or expired" page (no oracle).
- **Read-only in MVP:** shows salon name, service, staff display name, date/time (tenant timezone), and status. It shows no phone, email, notes, or other customers' data. **Amended 2026-11-04 (owner C2):** the customer may cancel a PENDING or CONFIRMED appointment from the link, using the existing `PENDING/CONFIRMED → CANCELLED` transition (new actor; C3 design in `docs/tasks/WP-06.md`). Reschedule by link stays out of scope.
- Headers: `noindex`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. Rate-limit lookups per IP.
- Delivery of the link: (1) the booking success page in MVP; (2) inside WhatsApp messages only after a Meta-approved template with a URL button exists (ADR-042 template lifecycle; separate approval).

## 6. NotificationService changes (design only)

- `channel` widens from `"WHATSAPP"` to `NotificationChannel`. Each channel has its own provider behind the existing provider interface: `WhatsAppProvider`, `WebPushProvider`.
- `recipients()` returns `(profileId, channels[])` per event; WhatsApp behavior and templates stay unchanged.
- Each channel is claimed and delivered independently: a Web Push failure never blocks WhatsApp and vice versa.
- Existing idempotency, `claim` / `markSent` / `markFailed` / `markUnknown` semantics are kept.

## 7. Migration plan

One additive migration, **generated and validated only in CI** (disposable PostgreSQL 17), never locally against Pilot:

1. `ALTER TYPE "NotificationChannel" ADD VALUE 'WEB_PUSH';`
2. `CREATE TABLE "PushSubscription"` + indexes + composite FKs.
3. `CREATE TABLE "AppointmentAccessToken"` + indexes + composite FKs.
4. `ENABLE` + `FORCE ROW LEVEL SECURITY` and the tenant policy on both tables (same pattern as `NotificationDelivery`).
5. Grants for the runtime role consistent with the existing tables.

There are no changes to existing columns or data and no backfill.

**Rollback:** drop the two new tables (no other table depends on them). PostgreSQL cannot drop enum values, so `WEB_PUSH` would remain unused, which is harmless. The application must be deployed so that old code ignores the new enum value.

**Pilot apply:** only after CI is green and the owner gives explicit approval (P8 gates).

**Note (WP-06, 2026-11-04):** the plan above is split per §9 phasing. Phase 2 ships `AppointmentAccessToken` alone in `20261104110000_appointment_access_token` (steps 3–4 for that table only); `WEB_PUSH` and `PushSubscription` follow in their own phase migration. Step 5 resolves to **no explicit GRANTs**: existing tenant tables have none, so the new table keeps the same grant posture (an optional `REVOKE ALL … FROM anon, authenticated` across all tables is a separate owner decision).

## 8. Tests required before merge

- Unit: token generation/hash/verify; expiry and revoked handling; routing matrix; per-channel independence; payload has no PII leakage.
- Integration (CI only): two-tenant RLS on both new tables (SELECT/INSERT/UPDATE/DELETE across tenants; missing context → no rows); token from tenant A unusable under tenant B's slug; subscription reassignment; `410` → revoked; inactive staff receives nothing.
- Regression: existing WhatsApp notification and public booking suites unchanged and green.

## 9. Phasing (each phase is its own PR)

1. **In-app Option A**: UI only, no schema.
2. **Status link**: migration (token table), booking-success link, status page with customer self-cancel (amended 2026-11-04).
3. **Web Push**: after the W11.10 PWA foundation lands: enum value, subscription table, provider, permission UX, routing.

Phases 2 and 3 can share one migration if approved together; otherwise each ships its own.

## 10. Owner decisions (resolved 2026-11-03)

1. In-app: **Option A**, derived from `Appointment`, no table. Option B is deferred until read/unread is required.
2. New dependency `web-push`: **approved** (for phase 3).
3. Web Push recipients for `APPOINTMENT_CREATED`: **assigned staff + all TENANT_ADMIN profiles** of the tenant.
4. Status-link expiry: **`endAt + 7 days`**.
5. Status link: read-only plus customer self-cancel in MVP (amended 2026-11-04); reschedule via link deferred.
   Amendment 2026-11-05 (owner decision, PR #183): staff/admin can move an open appointment (PENDING/CONFIRMED)
   in the day calendar (admin: any; active staff: own). Same staff/service, slot + closure + conflict re-check
   under the create advisory lock. **No customer notification yet**: needs a new `NotificationEventType`
   (`APPOINTMENT_RESCHEDULED`) and a per-reschedule idempotency key (migration), applied to staging and pilot
   before the code ships; WhatsApp template deferred by the owner. Staff see the change in-app (updatedAt).
6. Subscription revocation: after **5** consecutive transient failures (plus immediately on `404`/`410`).

Consequence: with Option A, the `IN_APP` enum value and `InAppNotification` table are **not** part of the migration (§7 step 1 adds `WEB_PUSH` only).

## 11. Out of scope

Customer Web Push / customer accounts; reminders; reschedule by link; SMS; review funnel; WhatsApp template customization; changes to booking state machine, availability, auth, or tenant model.
