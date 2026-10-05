# Domain Foundation

## Purpose

This document defines the boundary introduced by Issue #4 for tenant-aware application context.

The domain contract is deliberately framework-agnostic. It validates an opaque tenant identity and creates an immutable TenantContext; it does not authenticate a caller, resolve membership, or authorize access.

## Tenant identity assumptions

- A tenant ID is an opaque string.
- The domain layer rejects empty, surrounding-whitespace, overlong, and control-character-containing values.
- The current maximum length is 128 characters.
- No UUID, ULID, database-specific, or other persistence format is assumed here.
- Validation rejects invalid input rather than normalizing it.

The persistence representation must be aligned in a future database/domain issue rather than invented in this foundation layer.

## Future integration boundary

A future server-side trusted resolver will:

1. authenticate the caller;
2. resolve the caller's trusted tenant membership/context;
3. construct a TenantContext through the domain boundary;
4. pass that context explicitly into authorization and domain operations.

Creating a TenantContext is therefore **not** proof of authentication, membership, or authorization. Client-provided tenant identifiers must not be treated as trusted solely because they satisfy this domain validation.

Future persistence and RLS work remain separate concerns. RLS is defense in depth and does not replace application-level authorization.

## Out of scope

This foundation introduces none of the following:

- Supabase or Prisma integration
- PostgreSQL schema or migrations
- RLS
- authentication implementation
- authorization middleware
- server actions or route handlers
- booking logic
- UI behavior
- production database or deployment

Any extension of this contract or integration with infrastructure requires its own approved change.
