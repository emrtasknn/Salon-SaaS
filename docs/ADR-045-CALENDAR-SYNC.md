# ADR-045 — Phone Calendar Integration: Subscription Feed and Two-Way Sync

## Status
Proposed 2026-11-19. Owner direction recorded; implementation phases B and C still need the gates in §7.

## 1. Context
Salon owners and staff already keep appointments in Apple Calendar (iPhone) or Google Calendar (Android). Owner requirement (2026-11-19): they must be able to keep that habit and still use the app.

- Owner decisions (2026-11-19):
  - Appointments in the phone calendar **may show the customer name** (consent is collected at booking).
  - **Two-way sync is wanted.**
- Constraints:
  - AGENTS.md non-negotiables: tenant isolation/RLS, no client-trusted tenant ids, booking-semantics changes need approval, new external providers need escalation, no silent scope growth.

## 2. Options considered
| Option | What it gives | Why / why not |
|---|---|---|
| A. iCalendar **subscription feed** (one private URL per staff member) | App appointments appear in Apple/Google Calendar, updates included | No OAuth, works on every phone. Read-only; calendar apps poll on their own schedule (Apple: user-configurable, minutes; Google: hours). |
| B. **Google Calendar API** two-way (OAuth) | Outbound: appointments written to a dedicated "RandevuN" calendar right away. Inbound: busy time from the user's chosen calendars blocks online booking. | Covers Android and iPhone users who use Google; iOS Calendar can show a Google account. New provider, OAuth app, sensitive scopes → Google app verification for public use. |
| C. **Apple iCloud** via CalDAV (app-specific password) | Same as B for iCloud calendars | No official Apple API; users must create an app-specific password; fragile. Lowest priority. |
| D. Act as our own **CalDAV server** | Native "add account" on iPhone, true two-way for Apple | Large protocol surface (WebDAV/REPORT/ETag sync). Not justified for MVP. |
| E. Import native events as **appointments** | Literal two-way | Native events have no customer/service/consent. They would break booking invariants. Rejected. Inbound events become **busy blocks** only. |

## 3. Decision
1. **Phase A — subscription feed (now).** One revocable private feed per staff member; the admin also gets a whole-salon feed.
   - **Contents:** live appointments (pending + confirmed) from 30 days back to 180 days ahead, with customer name and service.
   - **Statuses:** cancelled and rejected appointments are dropped from the feed, so the subscribed calendar removes them.
2. **Phase B — Google two-way.** Per user, opt-in "Google Takvim'i bağla".
   - **Outbound:** create, update or delete events in a dedicated calendar the app creates (`RandevuN`).
   - **Inbound:** free/busy of the calendars the user picks becomes `ExternalBusy` blocks for that staff member.
   - **Availability:** availability excludes those blocks. This is a **booking-semantics change**: online slots shrink, and manual admin/staff creation shows a warning but is not blocked.
3. **Phase C — iCloud CalDAV.** Only if pilot users ask for it after A and B.
4. Native events never become appointments (option E rejected).

## 4. Phase A design
- **Table `CalendarFeedToken`:**
  - Fields: `id`, `tenantId`, `profileId`, `scope` (`STAFF_SELF` | `TENANT_ALL`), `tokenHash` (sha-256, unique), `createdAt`, `lastUsedAt`, `revokedAt`.
  - Integrity: composite FK `(tenantId, profileId)`.
  - RLS on: owner read/insert/revoke own; the feed route reads through the server only.
- **Token:** 32 random bytes, base64url, shown once (URL `webcal://<host>/api/calendar-feed/<token>.ics`); only the hash is stored.
- **Route:**
  - Lookup is by hash. The token resolves tenant + profile; nothing comes from the client.
  - Staff must be `ACTIVE`, the membership must exist, and `TENANT_ALL` requires `TENANT_ADMIN`.
  - Rate limited.
  - Headers: `Cache-Control: no-store`, `X-Robots-Tag: noindex`.
- **Lifecycle:**
  - Staff deactivation or membership removal makes the feed return 404.
  - "Bağlantıyı yenile" revokes the old token and issues a new one.
- **ICS:** reuses `src/domain/calendar-event.ts` escaping and folding.
  - UID = appointment id, so a change updates the event instead of duplicating it.
  - `X-WR-CALNAME` = "RandevuN — <salon>".
  - `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` = PT15M (a hint; clients may ignore it).
- **Privacy:** customer name and service per owner decision. Phone/email are not included. The feed URL is a bearer secret; the UI says so and offers revoke.

## 5. Phase B design (summary, to be detailed before implementation)
- **Tables (tenant-scoped, RLS):**
  - `CalendarConnection`: provider, profile, encrypted refresh token, chosen calendar ids, `RandevuN` calendar id, sync state.
  - `ExternalBusyBlock`: staff, start, end, source, external id hash.
  - `CalendarEventLink`: appointment ↔ external event id.
- **Sync mechanisms:**
  - Google push notifications (`events.watch`) plus incremental `syncToken` sync.
  - Scheduled renewal of watch channels and a periodic reconcile job.
- **Token encryption:** AES-GCM with a key from Vercel env; refresh-token revocation on disconnect, staff deactivation and membership removal.
- **Owner prerequisites:**
  - A Google Cloud project with the Calendar API enabled.
  - An OAuth consent screen and client id/secret in Vercel env.
  - Google app verification for the sensitive calendar scopes before public launch. The pilot can run in testing mode with listed test users.

## 6. Consequences
- Phase A gives "see everything in my phone calendar" quickly with no provider dependency.
- Phase B is the real two-way. Its cost is OAuth operations, a verification process and a booking-semantics change.
- Customer names leave our system into Apple/Google accounts of salon staff; KVKK notice text should mention it (owner/legal check).

## 7. Gates
| Phase | Gate |
|---|---|
| A | Migration applied by owner to staging + pilot (`pilot-migrated` label) before merge |
| B | Owner: Google Cloud project + OAuth client + env vars; architecture approval of the busy-block availability rule; migration as above |
| C | Re-evaluate after pilot feedback |
