# P7 — Pilot Acceptance Checklist and Evidence Register

## Status

**OPEN — acceptance evidence is incomplete.**

This document is an execution checklist and evidence register. It does not declare P7 complete. A checkbox may be marked complete only when the stated evidence is recorded.

## Scope and safety boundaries

- Use the dedicated test tenant `randevun-test-2026` for synthetic pilot data.
- Do not modify or delete existing pilot tenant records or customer appointments.
- Do not send messages to real customers. WhatsApp provider tests are restricted to the explicitly opted-in Meta test recipient(s).
- Do not retry a `NotificationDelivery` row in `UNKNOWN` automatically. First reconcile provider outcome using provider evidence; preserve the no-auto-retry safety rule.
- No production deployment is authorized by P7 acceptance.
- P7 closure does not imply P8 Production Readiness or P9 MVP Closure.

## Evidence already reported by the project owner

The following are owner-reported/manual observations, not independently reproduced by CI in this checklist:

- Dedicated test tenant `randevun-test-2026` was created.
- Test tenant admin login to `/admin` succeeded.
- A test staff member was created; the Supabase Auth user existed and its app metadata tenant ID matched the test tenant.
- Test service `Saç Kesimi` (30 minutes) was created.
- Working hours were configured (Monday–Saturday 09:00–18:00; Sunday closed).
- A synthetic booking request was created and appeared as `PENDING` in the staff appointment view.
- Earlier owner-confirmed WhatsApp device testing showed CREATED/CONFIRMED customer-facing messages; prior project evidence also records CREATED staff/customer delivery and CONFIRMED delivery. Treat those as historical smoke evidence, not proof of the current unresolved attempt.
- Two-tenant manual isolation checks were previously owner-confirmed and P6 is recorded complete; do not repeat unless a regression or code change warrants it.

## Current unresolved WhatsApp observation

The latest test appointment has two `APPOINTMENT_CREATED` delivery rows with the same appointment ID and different recipient profile IDs. The last row was reported as:

- channel: `WHATSAPP`
- status: `UNKNOWN`
- attemptCount: `1`
- providerMessageId: `NULL`
- lastErrorCode: `PROVIDER_OUTCOME_UNKNOWN`

The recipient profile for that last row was not conclusively identified. The message was not observed on the test recipient's device. This is an ambiguous provider outcome, not proof of delivery or non-delivery.

**Do not resend or reset this row.** Reconcile using server/provider logs and Meta test environment evidence first. Record the recipient profile and appointment ID without exposing phone numbers, email addresses, access tokens, or secrets.

## Acceptance checklist

### A. Pilot tenant and booking journey

- [x] Test tenant exists.
- [x] Tenant admin can access the admin panel.
- [x] Test staff exists and Auth app metadata tenant ID matches the test tenant.
- [x] Test service exists.
- [x] Working hours are configured.
- [x] Synthetic booking request exists and is visible as PENDING.
- [ ] Confirm booking details and tenant context from read-only DB evidence.
- [ ] Confirm staff can confirm the synthetic appointment.
- [ ] Confirm staff can reject a separate synthetic appointment.
- [ ] Confirm appointment state transitions are correct and do not depend on notification success.

### B. WhatsApp notification delivery

- [ ] Identify the recipient profile for the latest UNKNOWN CREATED delivery.
- [ ] Inspect redacted application logs for the provider request/response and classify the cause of UNKNOWN.
- [ ] Reconcile whether Meta accepted the message; do not infer from a missing device notification alone.
- [ ] If the outcome is proven not accepted, use a newly created synthetic appointment/delivery for a controlled retry test; do not reset the UNKNOWN row.
- [ ] Verify CREATED staff notification on the opted-in test recipient.
- [ ] Verify CREATED customer notification only if a valid opted-in test recipient is configured.
- [ ] Verify CONFIRMED customer notification on an opted-in test recipient.
- [ ] Verify REJECTED customer notification on an opted-in test recipient.
- [ ] Verify provider failure classification using a non-production controlled failure.
- [ ] Verify duplicate event/idempotency behavior without sending duplicate customer messages.
- [ ] Verify UNKNOWN remains non-retryable automatically.
- [ ] Record provider message IDs and final delivery states, redacting recipient PII.

### C. Webhook tenant routing (W11.6 dependency)

- [ ] Audit existing migrations for `WhatsAppIntegration`, resolver SQL function, grants, RLS and FORCE RLS.
- [ ] Verify resolver function ownership, schema qualification, search_path, execute grants, active integration filtering, and fail-closed behavior.
- [ ] Verify tenant context is transaction-local.
- [ ] Verify every delivery mutation is tenant-scoped.
- [ ] Verify unknown/inactive integration and unknown provider message cause no mutation.
- [ ] Verify Tenant A webhook cannot update Tenant B delivery.
- [ ] Verify duplicate and out-of-order status events cannot regress a terminal state.
- [ ] Verify Meta `read` status is a no-op.
- [ ] Verify invalid signature and malformed payload behavior.
- [ ] Run migration drift check and isolated-database integration tests.

### D. PWA / real-device acceptance

- [ ] Install/add the app to the home screen on a real mobile device.
- [ ] Launch from the installed app icon.
- [ ] Verify the public salon page loads.
- [ ] Complete the customer booking journey.
- [ ] Verify staff/admin appointment view reflects the booking.
- [ ] Verify navigation and core screens remain usable on mobile.
- [ ] Record device/browser/OS and evidence; no production customer data.

### E. Release evidence

- [ ] All relevant PR CI checks pass.
- [ ] Lint, typecheck, unit/integration tests, and production build pass.
- [ ] No unresolved P0/P1 pilot defects.
- [ ] Pilot acceptance evidence is attached or linked.
- [ ] Product owner reviews the evidence and explicitly approves P7 closure.

## Desktop execution order

1. Preserve current database rows; do not delete the test appointment or UNKNOWN delivery.
2. Read the UNKNOWN delivery's recipient profile and appointment relation.
3. Inspect redacted local/server logs around the corresponding send attempt and identify provider classification.
4. Inspect Meta test app logs for the same time window and provider message ID, if any.
5. Complete the W11.6 SQL/RLS audit before enabling or relying on webhook persistence.
6. Use new synthetic appointments for any fresh controlled delivery tests.
7. Run the PWA acceptance checklist on a real device.
8. Attach evidence and request explicit owner closure approval.

## P7 closure rule

P7 remains OPEN until sections A–E have evidence for every required criterion, all blocking defects are resolved, and the project owner explicitly approves closure. Historical manual evidence may satisfy a criterion only when its scope and provenance are recorded and no relevant code/configuration regression has occurred.

## Out of scope

- Meta Business verification / Tech Provider approval and production sender onboarding.
- Production deployment.
- Real customer messaging.
- P8 production readiness sign-off.
- P9 MVP closure.
