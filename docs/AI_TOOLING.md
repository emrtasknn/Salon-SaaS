# AI Tooling — Skills, Agents, MCP

Inventory of what exists today and the intake rules for adding tools (e.g. from external GitHub repos).
Nothing in this file installs or activates anything.

## Current inventory (verified 2026-11-03)

| Item | Path | Used by | Status |
|---|---|---|---|
| Root instructions | `CLAUDE.md` → imports `AGENTS.md` | Claude Code | Active |
| Repo rules | `AGENTS.md` | Cline, Codex-style agents, Claude (via import) | Active, canonical |
| Architect / Builder / Reviewer skills | `.agents/skills/{architect,builder,reviewer}/SKILL.md` | Cline (Agent Office v1) | Not auto-discovered by Claude Code (outside `.claude/`) |
| UI/UX skill | `.claude/skills/salon-saas-uiux/SKILL.md` (+ `references/`) | Claude Code | **No frontmatter** (`name`/`description`) → unreliable auto-selection |
| UI/UX agent | `.claude/agents/salon-saas-uiux.md` | Claude Code | **No frontmatter** → may not register as a subagent |
| Project MCP config | none (`.mcp.json` absent) | — | MCP lives in user-level client configs |
| ai-memory MCP | user-level Claude Desktop / Cline config; `.ai-memory.toml` in local copy | Claude Desktop, Cline | Project scope: `default` / `emrtasknn-salon-saas` (pass explicitly; static clients otherwise fall back to `scratch`) |
| GitHub MCP | referenced in `docs/AGENT_OFFICE_OPERATING_PROCEDURE.md` | Cline | Not configured for Claude Code |
| CI | `.github/workflows/ci.yml` | GitHub Actions | Active |

## Pending fixes (proposed, not applied)

1. Add frontmatter to the UI/UX skill and agent so Claude Code can select them:
   `name: salon-saas-uiux` + a narrow `description` ("Use for Salon SaaS screen/component design, UX copy, accessibility or UI QA. Not for backend/auth/booking logic.").
2. Decide whether Architect/Builder/Reviewer should also exist as Claude Code subagents (`.claude/agents/*.md` with frontmatter) or stay Cline-only. Avoid two diverging copies: one canonical body, the other a thin pointer.

## Where things go

| Kind | Location | Rule |
|---|---|---|
| Claude skill | `.claude/skills/<name>/SKILL.md` + `references/*.md` | Frontmatter required; short body; heavy material in `references/` loaded on demand |
| Claude subagent | `.claude/agents/<name>.md` | Frontmatter (`name`, `description`, optional `tools`); least-privilege tools |
| Cline/Agent Office skill | `.agents/skills/<name>/SKILL.md` | Keep in sync with any Claude equivalent by reference, not copy |
| Project MCP server | `.mcp.json` (committed, **no secrets**; use env var references) | Needs review: new external provider = escalation per `AGENTS.md` |
| User-only MCP (memory, personal tools) | client user config | Never commit |

## When a skill is worth it

Create one only for a workflow that recurs, is distinct, and has its own checklist. Candidate list (not created):
- `tenant-security-review` — RLS/authorization diff review (overlaps Reviewer; consider extending that instead)
- `prisma-migration` — schema change + RLS + integration test checklist
- `notification-change` — provider/idempotency/UNKNOWN-handling checklist
- `release-gate` — P7/P8/P9 evidence collection

Do not add skills "to save tokens": every skill's description is always in context; broad or overlapping skills cost more than they save.

## External GitHub repo intake

For each repo the owner proposes:
1. License + compatibility; maintenance activity; dependency and supply-chain risk.
2. What it really is: code dependency, Claude skill/agent, MCP server, or just reference docs.
3. Fit with governance: tenant isolation, no client-trusted tenant IDs, no new provider/dependency without justification (`AGENTS.md` #6), PWA-first.
4. Secrets/network: does it send data to third parties? (KVKK relevance for customer data.)
5. Write a short proposal (purpose, location per table above, risk class, rollback) → owner approval → separate PR.
Never copy external instructions or code without checking license and provenance.
