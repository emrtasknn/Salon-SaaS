# Supabase Auth Adapter

This adapter connects the provider-neutral `ServerAuthAdapter` contract to a server-side Supabase Auth client.

Flow:

`server request` → `Supabase Auth client` → `SupabaseAuthAdapter` → `ServerAuthAdapter` → `readApplicationIdentity()`

Only the server-derived Supabase user ID becomes the authentication subject. The existing ApplicationIdentity contract also requires profileId, so profile mapping is injected through `resolveProfileId`. This keeps profile persistence/mapping outside the provider-specific adapter. Profile provisioning and membership synchronization are not part of this issue.

Security rules:
- Never trust client-provided tenant IDs, roles, profile IDs, or similar metadata.
- TenantContext remains owned by tenant resolution.
- Authorization remains centralized in `evaluateAuthorization()` and `authorize()`.
- Provider/auth failures fail closed.
- No implicit SUPER_ADMIN bypass.
- Provider-specific types stay at the infrastructure edge.

Non-goals:
- Supabase middleware or cookie/session plumbing
- PostgreSQL RLS
- schema/migrations
- tenant membership creation
- profile provisioning
- booking/UI
- production secrets/deployment
- authorization policy changes

A future integration may construct the server-side Supabase client using the approved Next.js/Supabase session mechanism; that wiring remains separate from this adapter.
