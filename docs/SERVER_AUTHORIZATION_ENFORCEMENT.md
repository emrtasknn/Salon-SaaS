# Server Authorization Enforcement Boundary

Issue #26 establishes the application-level enforcement seam that future Next.js Server Actions and Route Handlers can call before entering protected use cases.

## Flow

`server request -> server auth boundary -> trusted tenant resolution -> server authorization enforcement -> use case`

The enforcement boundary accepts only:

- `ApplicationIdentity` produced by the server authentication boundary
- `TenantContext` produced by trusted tenant resolution
- required `TenantRole`
- injected `MembershipReader`

It delegates to the existing `evaluateAuthorization()` composition. It does not implement a second authorization policy.

## Security rules

- Client-provided `tenantId`, `subjectId`, `profileId`, and `role` are not trusted inputs.
- Tenant authority remains `TenantContext`.
- Authentication authority remains the server-side auth boundary.
- Membership persistence remains behind `MembershipReader`.
- Authorization semantics remain in `authorize()`.
- Persistence failures fail closed.
- SUPER_ADMIN has no implicit global bypass.
- The boundary itself does not create Prisma clients or perform persistence queries.

## Result

The returned decision contains:

- the existing `AuthorizationResult`
- the membership lookup outcome

A future Server Action or Route Handler should continue only when the authorization status is `allowed`. Denied outcomes must not enter the protected use case.

## Explicit non-goals

This issue does not add:

- Supabase Auth SDK/session/cookie handling
- Next.js middleware
- PostgreSQL RLS
- schema or migrations
- booking logic
- UI
- production configuration/deployment
