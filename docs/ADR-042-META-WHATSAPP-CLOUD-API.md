# ADR-042 — Meta WhatsApp Cloud API and Hybrid Sender Policy

- **Status:** Proposed for review
- **Decision scope:** Product/architecture direction and required safety constraints
- **Implementation status:** Not approved by this document alone
- **External prerequisite:** Validate the shared platform sender model against applicable Meta and provider terms before production use

## Context

Salon-SaaS sends appointment notifications through the provider-neutral notification boundary. The current Meta adapter is configured from global environment variables (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION, and WHATSAPP_TEMPLATES_JSON), while the Prisma schema also has tenant-scoped WhatsAppIntegration records. The current runtime does not yet resolve a sender from platform policy plus tenant configuration.

The previous tenant-owned-only assumption does not match the agreed product direction. The product direction is a hybrid model, but a shared Randevu'N sender must not be treated as production-approved until its multi-tenant use is validated with the applicable Meta/provider terms.

## Proposed decision

Use **Meta WhatsApp Cloud API** behind the existing provider-neutral notification boundary. Support two sender modes in the architecture:

1. **Platform-managed sender:** a Randevu'N-managed WhatsApp Business sender using centrally managed, Meta-approved templates.
2. **Tenant-connected sender:** a salon's own WhatsApp Business account, only where platform policy explicitly allows it for that tenant.

The MVP should prefer the platform-managed sender to reduce onboarding friction **only if** the shared multi-tenant sending model is confirmed to be permitted. If it cannot be validated, shared sending is not approved for production; return to architecture review before choosing a launch fallback. Do not silently assume tenant-owned sending or another provider as the fallback.

## Platform policy and tenant permissions

- SUPER_ADMIN alone controls which sender modes are allowed, the platform default sender mode, and whether an individual tenant may connect/use its own WhatsApp Business account.
- TENANT_ADMIN cannot change platform-wide sender policy or choose a mode that platform policy disallows.
- When tenant-owned mode is enabled for a tenant, that tenant's TENANT_ADMIN may manage only that tenant's connection and view its status.
- A tenant administrator must never read, mutate, or select another tenant's integration, credentials, templates, delivery records, or sender configuration.

These are authorization requirements, not a claim that the corresponding management UI or policy store already exists.

## Server-side sender resolution

Resolve the effective sender for each notification on the server using trusted tenant context, platform policy, and the applicable tenant configuration.

- Never trust client-supplied tenant IDs, sender modes, account/phone-number IDs, recipients, template IDs, or template approval states for authorization.
- Validate the resolved account, sender mode, template mapping, and tenant association before sending.
- Fail closed when policy, sender/account, or required approved/enabled template configuration is missing, disabled, inconsistent, or ambiguous.
- Never silently fall back to another tenant's account or configuration.
- Keep platform credentials in server-side infrastructure secrets. Never accept them from browser input, expose them to clients, log them, or commit them to source control.

## Templates and notification content

- Initial scope uses centrally managed, Meta-approved templates.
- Resolve recipient numbers and template parameters server-side from trusted appointment, tenant, service, staff, and profile data.
- Where appropriate, message content must clearly identify the salon associated with the appointment and Randevu'N's role in sending the notification.
- Template names and languages are configuration, not hard-coded business state.
- Do not send a template that is missing, disabled, unapproved, or not valid for the resolved sender.
- Salon-specific template customization, preview/testing, and submission/review/approval lifecycle are post-MVP unless separately approved.

## Tenant isolation, delivery, and idempotency

- Preserve tenant-scoped notification persistence and idempotency.
- Keep tenant notification configuration, template mapping, tenant-connected account metadata, delivery records, and idempotency keys tenant-scoped.
- Platform-owned sender configuration must be represented and authorized distinctly from tenant-owned account configuration; a platform sender must not be assigned to a tenant by unsafe inference.
- Sender resolution must not weaken RLS, tenant-context requirements, or server-side authorization.
- Preserve the existing provider-neutral notification boundary so appointment state transitions are not coupled to Meta-specific behavior.

## Webhook requirements

- Verify webhook authenticity against the raw request body using the Meta app secret before processing status events.
- Resolve each webhook phone-number ID to the correct sender ownership/configuration using a trusted server-side mapping. The mapping must support the approved sender modes without guessing a tenant.
- Apply status changes only to delivery records belonging to the resolved tenant and the matching provider message ID.
- Unknown or ambiguous sender mappings must fail closed: do not update any tenant's delivery records.
- Handle repeated/out-of-order provider status events idempotently.
- Do not introduce global uniqueness for providerMessageId or change webhook tenant routing/storage without a separate reviewed implementation plan and the required explicit approval.

## Reminder lifecycle

Configurable reminder timing, visible delivery status, and reminder scheduling are productization work, separate from initial appointment-event notifications. Appointment changes and cancellations must safely reschedule or suppress pending reminders and avoid duplicate sends.

## External validation gate

Before treating platform-managed shared sending as production-approved, collect evidence that the proposed multi-tenant use is permitted under the applicable Meta and provider terms and verify the operational requirements for approved templates, delivery/failure reporting, webhook routing, and idempotency. Mocks and CI alone do not satisfy this gate.

If the shared-sender model cannot be validated, stop and return to architecture review. Do not make an unreviewed fallback choice.

## Implementation and change-control gates

This ADR proposal records the intended hybrid direction and constraints; it does **not** authorize implementation by itself.

Before implementation:
1. Review the existing runtime, WhatsAppIntegration schema, RLS policies, tenant-context boundary, template mapping, and webhook routing against this decision.
2. Propose the minimum necessary policy/configuration model and data-flow changes.
3. Identify whether a schema migration is required and review its tenant-isolation implications.
4. Add tests for sender-policy enforcement, missing/ambiguous configuration, cross-tenant isolation, template fail-closed behavior, webhook mapping, idempotency, and failure handling.
5. Validate the real Meta/provider path before production approval.

No credentials, production configuration, webhook routing, application code, or database schema/migration changes are approved by this documentation PR. Any C2/C3 change must follow Architect → Human Approval → Builder → CI → Reviewer → Human Merge Approval → Merge. No migration may be generated or applied without the relevant explicit approval.

## Consequences

- The architecture can support both platform-managed and tenant-connected sender modes without hard-coding a single mode.
- Platform policy and tenant account management have distinct authorization boundaries.
- The existing global-env runtime is an implementation gap that must be addressed before claiming the hybrid model is implemented.
- Production use of the shared platform sender remains blocked on external Meta/provider validation.
- The mock provider remains useful for tests, but does not establish production readiness.
