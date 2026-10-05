# Agent Office Handoff Schema

The handoff schemas are TypeScript contracts in `src/agent-office/handoff-contract.ts`. They are intentionally framework-agnostic and do not depend on GitHub or product-domain types.

## Architect → Builder

Required fields:
- `kind`
- `task`
- `acceptanceCriteria`
- `sourceOfTruth`
- `implementationPlan`
- `expectedFiles`
- `doNotChange`
- `impact`
- `testPlan`
- `risks`
- `openQuestions`
- `humanApprovalRequired`

## Builder → Reviewer

Required fields:
- `kind`
- `task`
- `implementedFiles`
- `testsAndChecks`
- `migrationImpact`
- `securityTenantBookingImpact`
- `deviations`
- `knownLimitations`

## Reviewer → Human

Required fields:
- `kind`
- `task`
- `verdict`
- `blockers`
- `requirementCoverage`
- `securityStatus`
- `tenantIsolationStatus`
- `testStatus`
- `scopeDrift`
- `recommendation`

The contracts are validation-oriented: they reject incomplete artifacts without prescribing a specific storage backend.
