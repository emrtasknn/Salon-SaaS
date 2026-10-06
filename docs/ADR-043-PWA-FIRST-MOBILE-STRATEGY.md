# ADR-043 — PWA-First Mobile & Notification Distribution Strategy

## Status

Accepted — effective for W11 and subsequent roadmap planning.

## Context

Salon-SaaS needs a practical mobile experience for salon staff without creating a second native application stack before the product has validated the need for it.

The product already has a responsive web application, server-authoritative appointment workflows, tenant isolation, and a provider-neutral notification boundary. The pilot requires staff to act quickly from a phone when a customer creates an appointment request.

## Decision

Salon-SaaS adopts **PWA-first** as the official mobile/distribution strategy.

The target distribution model is:

- Responsive Web for all supported browsers
- PWA installability for staff mobile usage
- Web Push for supported installed PWAs
- WhatsApp for customer-facing appointment communication
- Native iOS/Android only as a conditional future expansion when a validated requirement cannot be met reliably by PWA

PWA is therefore part of the core product strategy and is not deferred to a later native-mobile phase.

## Notification architecture

The approved conceptual boundary is:

```
Appointment Event
  → NotificationService
      → WhatsAppProvider
      → WebPushProvider
```

Provider-specific behavior must remain behind provider interfaces. Appointment lifecycle semantics remain independent of delivery success.

## Web Push constraints

Before implementation of persistent subscriptions, architecture review must explicitly resolve:

- tenant ownership
- profile ownership
- subscription endpoint/public key/auth secret handling
- multiple devices per profile
- subscription revocation and expiration
- staff deactivation behavior
- cleanup of invalid subscriptions
- RLS and server-side authorization
- notification idempotency and delivery/error handling

A possible `PushSubscription` model is an architectural candidate, not an approved schema.

## Security

- Browser-provided tenant/profile identifiers are never authoritative.
- Notification subscriptions must be associated server-side with an authenticated/trusted profile context.
- Secrets are server-side only.
- Push permission requests must be initiated by an explicit user action.
- Notification delivery failure must not silently mutate appointment state.

## Consequences

Positive:
- one primary application codebase
- faster pilot validation
- no App Store/Play Store dependency for the initial staff product
- installable app-like mobile experience
- Web Push and WhatsApp complement each other

Trade-off:
- platform-specific PWA/browser behavior must be tested on real devices
- some capabilities may eventually require native applications

## Reconsideration trigger

Native applications may be reconsidered only after a concrete product requirement is documented and demonstrated to be materially constrained by PWA, such as a required platform capability, reliability constraint, or validated user workflow that cannot be met adequately on the web.
