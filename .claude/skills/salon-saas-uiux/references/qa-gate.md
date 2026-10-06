# Salon-SaaS UI/UX QA Gate

## Evidence required

Before PASS, inspect the actual implementation or approved design artifact and verify:

- primary user goal
- correct role visibility
- valid appointment actions
- loading/empty/error/success states
- keyboard focus and interaction
- touch targets
- responsive behavior
- semantic/accessibility structure
- application contract
- tenant/security boundary
- content truthfulness
- visual hierarchy
- anti-slop quality

## Verdict

### PASS

All applicable checks are supported by evidence.

### FAIL

One or more concrete defects are present. List each defect, evidence, severity, and recommended correction.

### BLOCKED

A required domain, backend, authorization, tenant, booking, or product decision is unavailable or contradictory.

A BLOCKED verdict is not permission to invent the missing contract.

## Severity

- P0: security, tenant isolation, authorization, or destructive workflow risk
- P1: broken core journey or incorrect domain action
- P2: accessibility, responsive, or important interaction defect
- P3: polish/consistency issue

P0/P1 defects block readiness.
