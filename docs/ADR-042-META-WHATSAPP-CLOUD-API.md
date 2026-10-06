# ADR-042 — Meta WhatsApp Cloud API Provider

## Decision

Salon-SaaS uses **Meta WhatsApp Cloud API** as the production WhatsApp provider.

The provider is accessed only behind the existing provider-neutral notification boundary from W08.

## Tenant ownership

The intended SaaS model is tenant-owned WhatsApp Business assets/numbers. Onboarding and credential exchange are separate from appointment-domain logic.

Provider credentials are infrastructure secrets and must never be accepted from browser/client input or committed to source control.

## Message transport

Business-initiated appointment notifications use approved WhatsApp templates. The provider adapter receives:
- recipient phone
- template key
- resolved template parameters
- tenant-independent message body for mock/testing compatibility

Template names/languages are configuration, not hard-coded business state.

## Webhooks

Webhook authenticity is verified against the raw request body using the Meta app secret before status processing.

Provider status events are identified by provider message ID and must be handled idempotently.

## Out of scope

- WhatsApp-based appointment approval/rejection
- payment/billing
- automatic production deployment
- onboarding UI
- provider credential persistence design beyond the infrastructure boundary

## Security constraints

- Never log or persist access tokens/app secrets.
- Never trust client-provided recipient numbers for authorization.
- Preserve tenant-scoped notification persistence and idempotency.
- Fail closed when a required template is not configured.

## Consequence

W08 remains testable with the mock provider, while W09 adds the real Meta transport without coupling appointment state transitions to Meta-specific behavior.
