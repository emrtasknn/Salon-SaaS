# Agent Office Operating Procedure v1

## Normal task

1. Create or select a GitHub Issue with explicit acceptance criteria and risk class.
2. Determine the applicable execution path.
3. Architect produces the structured handoff for C2/C3 work or when planning is useful.
4. Human approves the plan when required.
5. Builder executes only within the approved file allowlist and do-not-change boundary.
6. Builder records tests, checks, deviations and limitations.
7. Reviewer independently evaluates the diff and evidence.
8. CI must pass before merge.
9. Human approves merge.
10. Record the merge result and close/advance the task.

## C0/C1 shortcut

A low-risk task may skip Architect or explicit plan approval when governance permits. The task still requires tests/checks and review appropriate to its risk.

## C2/C3 path

C2/C3 work uses:

TASK → ARCHITECT → PLAN_READY → HUMAN_APPROVAL_REQUIRED → BUILDING → VALIDATING → REVIEWING → READY_FOR_MERGE → HUMAN → MERGED

## Failure handling

- Validation failure: return to Builder within the attempt budget.
- Reviewer changes required: return to Builder.
- Architecture ambiguity: return to Architect once.
- Security/data-integrity blocker: BLOCKED + human escalation.
- Retry budget exhausted: HUMAN ESCALATION.

## Cline / MCP operation

The current v1 toolchain is:
- Cline for agent execution.
- `AGENTS.md` for global repository rules.
- Agent Skills for role-specific instructions.
- GitHub MCP for issues, branches, PRs and review operations.
- GitHub Actions for CI evidence.

The toolchain is not presented as fully autonomous orchestration yet. A human/external trigger initiates the task; durable state and handoff contracts prevent the workflow from depending on chat memory.
