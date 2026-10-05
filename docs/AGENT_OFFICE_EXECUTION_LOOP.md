# Agent Office Execution Loop

## Purpose

This document turns Agent Office OS v1 from a role description into an explicit execution contract. GitHub remains the durable task/control plane; chat history is not execution state.

## State flow

`BACKLOG → ARCHITECT → PLAN_READY → HUMAN_APPROVAL_REQUIRED → BUILDING → VALIDATING → REVIEWING → READY_FOR_MERGE → MERGED`

Recovery states:

- `CHANGES_REQUIRED → BUILDING`
- `FAILED_RECOVERY → ARCHITECT|BUILDING|BLOCKED`
- `BLOCKED → ARCHITECT|BUILDING|FAILED_RECOVERY`

C0/C1 work may use the shortest applicable path. C2/C3 work requires the human approval gate before implementation when architecture or scope is affected.

## Role readiness

| Role | Ready when | Output |
|---|---|---|
| Architect | task is ready and source-of-truth is available | Architect handoff |
| Builder | approved handoff exists and implementation is permitted | Builder report + PR |
| Reviewer | Builder report, diff and validation evidence exist | Reviewer report |
| Human | C2/C3 approval gate or merge gate is reached | approval / escalation |

No role should infer readiness solely from chat context.

## Recovery

- Builder: maximum 2 implementation attempts.
- Architecture re-evaluation: maximum 1.
- Reviewer `CHANGES_REQUIRED` returns to Builder while budget remains.
- Security, data-integrity, or architecture blockers stop the loop and require human escalation.

## Durable audit trail

The minimum record is:
1. task/issue
2. state transition
3. agent role
4. attempt number
5. handoff/report
6. CI/validation evidence
7. reviewer verdict
8. human approval
9. merge result
10. recovery reason, when applicable

## Human authority

Human approval remains mandatory for:
- C2/C3 plan approval where required
- merge
- production deployment
- production DB actions
- governance exceptions

## Current Cline operating path

Cline supplies the agent execution environment. `AGENTS.md` supplies repository-wide rules. Agent Skills provide role-specific operating instructions. GitHub MCP provides durable GitHub operations. CI provides automated validation.

In this v1 implementation, these pieces are **contracts and operating surfaces**, not a claim of fully autonomous orchestration. A human or external trigger still starts the appropriate Cline task. The execution state and handoffs are now explicit and testable.

## Non-goals

This contract does not implement product behavior, authentication, tenant resolution, RLS, booking logic, production deployment, or autonomous C2/C3 merging.
