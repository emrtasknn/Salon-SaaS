# Server Authentication Request Boundary

## Purpose

This boundary converts trusted server-side authentication state into the existing provider-neutral ApplicationIdentity contract.

Dependency direction:

Server request -> ServerAuthAdapter -> ApplicationIdentity -> existing application authorization composition.

## Trust rules

- The adapter is the only boundary allowed to read the future authentication provider/session state.
- Subject ID and profile ID must originate from server-side authentication state, not request payloads.
- Tenant ID and role are deliberately not authentication inputs.
- TenantContext remains owned by tenant resolution.
- Authorization remains owned by the existing authorization composition and authorize() contract.
- Missing, malformed, or unavailable authentication state fails closed to unauthenticated.

## Future Supabase seam

A future Supabase implementation should implement ServerAuthAdapter and translate the provider's server-side session/user state into the existing ApplicationIdentity contract.

This document does not authorize adding Supabase SDK/session/cookie logic, middleware, RLS, or production configuration to this boundary.
