# W10 UI/UX → Builder Handoff

## Approved constraints
- Preserve auth, trusted TenantContext, authorization and RLS.
- Never trust client tenantId, subjectId, profileId or role.
- Preserve appointment lifecycle and booking concurrency.
- Do not add schema/migrations/providers without separate approval.
- Do not expand MVP.

## Builder sequence
1. inspect exact current application/persistence contracts
2. establish server boundary
3. implement approved screens and actions
4. wire existing application use cases
5. add integration/E2E coverage
6. run lint/typecheck/test/build
7. submit implementation for UI/UX QA and Reviewer

## Stop conditions
STOP if:
- required application contract is missing
- role semantics conflict
- tenant authority is unclear
- appointment semantics require change
- schema/provider change appears necessary
- public/private data boundary is unclear

Do not guess; escalate.
