# Supabase Server Client Boundary

## Purpose

This infrastructure module defines the server-only boundary for constructing a Supabase client used by server-side authentication.

The module is explicitly marked with Next.js `server-only`. It must not be imported by client components.

## Contract

`createSupabaseServerClient(config, factory)` validates the required public Supabase URL and public/anon key, then delegates construction to an injected factory.

The factory is injectable so tests and future runtime-specific construction can remain isolated from the authentication contracts.

## Security

- This boundary is server-only.
- It accepts only the public Supabase URL and public/anon key.
- Service-role credentials are not part of this contract.
- Authentication remains server-derived.
- Tenant resolution and authorization remain separate boundaries.
- Auth failures are handled by the existing Supabase Auth adapter and fail closed.

## Non-goals

This issue does not implement:
- RLS
- middleware
- login UI
- profile provisioning
- membership synchronization
- schema/migrations
- production secrets/deployment
- authorization policy changes
