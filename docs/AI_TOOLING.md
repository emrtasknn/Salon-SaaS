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
| Project MCP config | `.mcp.json`: Playwright MCP `@playwright/mcp@0.0.83 --isolated` (local browser automation, no secrets, pinned; added 2026-11-05) | Claude Code (approve on first load) | Use for staging/local UI checks only; never type real credentials or pilot data into it |
| ai-memory MCP | user-level Claude Desktop / Cline config; `.ai-memory.toml` in local copy | Claude Desktop, Cline | Project scope: `default` / `emrtasknn-salon-saas` (pass explicitly; static clients otherwise fall back to `scratch`) |
| GitHub MCP | referenced in `docs/AGENT_OFFICE_OPERATING_PROCEDURE.md` | Cline | Not configured for Claude Code |
| CI | `.github/workflows/ci.yml` | GitHub Actions | Active |
| Claude Code runtime | Desktop app, Claude Code 2.1.309; no standalone `claude` CLI on PATH | Claude Code | Active |
| User plugins / hooks | `~/.claude/settings.json`: `enabledPlugins` empty, no hooks, no user skills/agents | — | Superpowers + context7 offered via app install card 2026-11-03 (owner enables; Superpowers adds a SessionStart hook; context7 = remote MCP `mcp.context7.com`, needs Context7 sign-in) |
| Graphify CLI | `%USERPROFILE%\.graphify\venv\Scripts\graphify.exe` (graphifyy 0.9.101, dedicated venv, not on PATH) | Claude Code via Bash | Installed 2026-11-03, code-only (`GRAPHIFY_BACKEND=none`). Output `graphify-out/` (gitignored, ~3.6 MB, synced by OneDrive). Rollback: delete `%USERPROFILE%\.graphify` and `graphify-out/` |
| Supabase connector | claude.ai connector (not in repo/user config) | Claude Code sessions | **Write-capable** (`execute_sql`, `apply_migration`, `pause_project`…) — see risk below |
| Claude Code auto memory | `~/.claude/projects/<repo>/memory/` | Claude Code | Available, empty |
| Unknown script | `.agents/mpix.py` (UTF-16, untracked) | ? | Not reviewed — do not run |

## Former pending fixes (done 2026-11-03)

1. UI/UX skill and agent now have frontmatter (`name: salon-saas-uiux`, narrow `description`; agent also `tools`).
2. Architect/Builder/Reviewer exist as Claude Code subagents that point to the canonical `.agents/skills/*` bodies (no copies): `salon-saas-planner` → architect, `salon-saas-backend` → builder, `salon-saas-reviewer` → reviewer. See "Claude Code agent roles" below.

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

## Tool intake evaluation — 2026-11-03

Sources: each project's GitHub README / official docs, checked 2026-11-03. Star counts omitted (inconsistent across mirrors).
Decision key: **Approve?** = recommended, waits for owner approval · **Trial** = one-off use only · **No** = not installed (reason given) · **Research** = reference only.
Nothing below is installed in the repo or user config. Graphify ran once in an isolated venv on a `git archive HEAD` copy in the session scratch dir.

| # | Tool (official source) | What it is | Fit / overlap | Cost / risk | Decision |
|---|---|---|---|---|---|
| 1 | Superpowers (`obra/superpowers`, MIT; in official plugin directory) | Workflow skills: brainstorm → plan → TDD → subagent-driven dev → review | Matches READ→PLAN→IMPLEMENT→TEST→REVIEW; overlaps ECC | Skills load on demand; small hook surface | **Approve?** (user scope) — pick this *instead of* ECC |
| 2 | Everything Claude Code (`affaan-m/everything-claude-code`) | Large bundle: many agents, skills, commands, hooks, rules | Duplicates Superpowers + repo governance; rules not shipped by plugin | Many always-on hooks/scripts; large description footprint | **No** (borrow ideas only) |
| 3 | Graphify (`safishamsi/graphify`, PyPI `graphifyy` 0.9.101, MIT/Apache-2.0) | Local tree-sitter code graph + `explain` / `path` / `query` | No overlap; complements grep | Code-only mode: no LLM, 0 tokens to build; ~2.7 MB in `graphify-out/` | **Approve?** — CLI in user scope, code-only, `graphify-out/` gitignored (see below) |
| 4 | Claude-Mem (`thedotmack/claude-mem`, Apache-2.0) | Hooks capture tool activity, AI-compress it, re-inject later | Overlaps ai-memory MCP + auto memory + `SESSION_HANDOFF.md` | Records tool outputs (a file read can include secrets); background worker; third-party $CMEM token around the project | **No** — keep ai-memory + handoff |
| 5 | UI UX Pro Max (`nextlevelbuilder/ui-ux-pro-max-skill`, MIT) | Style/palette/font catalog + search scripts | Supports Next.js/Tailwind; repo already has UI/UX skill + `docs/w10-uiux/06-design-system-and-qa.md`, but `globals.css` defines only 2 tokens | Catalog can contradict project tokens once they exist | **Trial** — one design-token task, then remove |
| 6 | Caveman (`JuliusBrussee/caveman`; in official directory) | Terse output style + memory-file compression | Output style only | Independent measurement: 12–23% output-token cut (README claims 65–75%); output is a small share of cost; nuance can drop in reviews | **No** globally; optional per session for exploration chatter, never for review/security/specs |
| 7 | Find Skills (`vercel-labs/skills`, `npx skills`) | CLI + meta-skill to search/install skills from skills.sh | Built-in plugin directory already covers discovery | `npx` runs a remote package; installs straight into agent dirs | **No** install; `npx skills find <q>` read-only if needed, installs go through intake |
| 8 | Claude Code Router (`musistudio/claude-code-router`, MIT, v3.1.3, Node 22+) | Local proxy (127.0.0.1:3456) routing Claude Code to other providers | Needs standalone `claude` CLI (not installed); Desktop app does not route through it | Free tiers are rate-limited and may train on prompts; tool calling weak on many free models | **Not now** — see routing section; owner must pick a provider and create the key |
| 9 | Elephant-Goldfish Model (`google/elephant-goldfish-model`, Apache-2.0, released 2026-10-22) | Persistent "elephant" writes the spec; zero-context "goldfish" subagents review it | Fits escalation-class work (RLS, booking, tenant model) | Heavy token use per review | **Trial** on the next escalation-class spec |
| 10 | Ponytail (`DietrichGebert/ponytail`, MIT; needs CC ≥ 2.1.290) | Anti-over-engineering skill + `/ponytail-review` | Same goal as AGENTS.md #10 and Superpowers YAGNI | Many forks — official repo only | **Research** — revisit if diffs grow |
| 11 | DeepSeek superagent prototype (`deepseek-ai/dsh-superagent-prototype`) | Research prototype on DeepSeek Harness; opens PRs on its own from GitHub/Feishu | Conflicts with "no autonomous changes without approval" | Self-described as possibly buggy; preview platform | **Research** |
| 12 | Harness² (`google-research/harness2`, Apache-2.0) | Agent rewrites its own prompts/guardrails/skills per task | Self-editing guardrails conflicts with governance | Research release, not a supported product | **Research** |
| 13 | Karpathy skills (`forrestchang/andrej-karpathy-skills`) | One CLAUDE.md with 4 coding principles | Already covered by AGENTS.md non-negotiables | Adds always-on context | **No** |
| 14 | Agent-Reach (`Panniantong/Agent-Reach`) | CLI for X/Reddit/YouTube etc. via unofficial paths | Not needed; WebSearch/WebFetch suffice | ToS risk on connected accounts | **No** |
| 15 | "Vercel Agent Desktop" | Not found. Closest: `vercel-labs/agent-browser` (Apache-2.0, CDP browser + Electron apps) | Built-in browser pane + Claude in Chrome already available | Extra global npm binary | **No** |

### MCP / plugin items worth considering

| Item | Why | Decision |
|---|---|---|
| Supabase connector | Already connected and write-capable; target project may be the Pilot (real data) | **Owner action:** limit to read-only / a dev project, or disable for this repo. Agents never call its write tools |
| `context7` (official directory) | Current docs for Next.js 16 / Prisma 7 / Supabase SSR; read-only | **Approve?** (user scope) |
| `skill-creator` (Anthropic) | Build and evaluate the candidate project skills listed above | **Approve?** when the first project skill is created |
| `code-review`, `security-review` | Built in | Use; nothing to install |
| `pr-review-toolkit`, `feature-dev`, `frontend-design` | Overlap Superpowers / UI/UX skill | **No** for now |

### Graphify on this repo

Verified run (2026-11-03, code-only, `GRAPHIFY_BACKEND=none`): 226 files → 1,464 nodes, 2,669 edges, 106 communities, 8.4 s, 0 LLM tokens. Markdown headings are included structurally; no import cycles.
- Gaps: `prisma/schema.prisma` and CSS are **not parsed** → read the schema directly. Free-text `graphify query` is noisy; `explain "<symbol>"` and `path "A" "B"` are precise, with file:line.
- Measured context for "who uses `withPrismaTenantContext`": `graphify explain --all` 3.4 KB · `grep -rn` 6.3 KB · reading the importing files 59.6 KB.
- Never paste `GRAPH_REPORT.md` (~30 KB) or `graph.json` (~1.2 MB) into CLAUDE.md or prompts. The curated result is `docs/PROJECT_CONTEXT.md` "Module map".
- Setup (applied 2026-11-03, owner-approved): dedicated venv (no `uv`/`pipx` on this machine), `graphify-out/` in `.gitignore`, `.graphifyignore` committed-ready. Run after pulls: `$env:PYTHONIOENCODING='utf-8'; $env:GRAPHIFY_BACKEND='none'; & "$env:USERPROFILE\.graphify\venv\Scripts\graphify.exe" update .`
- Known quirk: `graphify update` still indexed `package-lock.json` despite `.graphifyignore` (harmless). It AST-parses `.agents/mpix.py` (parse only, never executed). Skip `graphify install --strict` and `graphify hook install` (they add hooks / git hooks) until the CLI has proven useful. Never run the semantic pass with an external API key on this repo.

### Free-model routing (Claude Code Router) — verified limits

| Provider | Free access (checked 2026-11-03) | Caveats |
|---|---|---|
| OpenRouter `:free` models | 20 req/min; 50 req/day, or 1,000/day after ≥ $10 lifetime credit purchase (`openrouter.ai/docs/limits`); failed calls count | Free endpoints may log/train on prompts depending on upstream; list changes often; tool calling inconsistent |
| Google Gemini API (AI Studio) | Free tier limited to Flash / Flash-Lite since 2026-04-01; per-project limits shown in AI Studio (third-party figures vary 500–1,500 RPD) | Unpaid-tier content may be used to improve Google products → not for proprietary code or customer data |
| Groq | Per-model free limits (example row: 30 RPM / 1,000 RPD / 200k TPD) | Org-level limits; extra keys add nothing |
| Cerebras | Open no-card tier reportedly ended 2026-07-21; $5 promo credit needs a card | Treat as **not free** |
| Ollama (local) | Free and private | Needs local GPU/RAM; coding and tool use well below Claude |

Proposed routing — only if the owner approves a provider and creates the key; key lives in a user env var, never in the repo or OneDrive:

| Task | Model |
|---|---|
| Code explanation, repo Q&A, doc drafts | Free model OK (no secrets or customer data in the prompt) |
| Unit-test drafts, simple bug fix | Free-model draft → Claude review before merge |
| Backend / frontend features, code review, architecture, anything touching auth/RLS/tenant/booking/migrations/notifications | Claude only |
| Deploy / migration / production data | No agent; human approval |

CCR runs as a separate terminal profile (`ccr code`) so the Desktop app login is untouched. It needs the standalone Claude Code CLI first.

### Claude Code agent roles (`.claude/agents/`, created 2026-11-03)

One canonical body per role; `.agents/skills/*` (Cline) stays, the Claude agent points to it.

| Agent file | Tools | Writes | Must not |
|---|---|---|---|
| `salon-saas-planner.md` (→ architect) | Read, Grep, Glob, Bash (read-only by instruction) | nothing; plan in its reply | edit code |
| `salon-saas-backend.md` (→ builder) | Read, Grep, Glob, Edit, Write, Bash | `src/domain`, `src/application`, `src/infrastructure`, `src/persistence` | change RLS/auth/booking semantics without escalation; touch `prisma/` |
| `salon-saas-database.md` | Read, Grep, Glob, Edit, Write (no Bash) | `prisma/schema.prisma` + new migration folder, as a proposal | run `prisma migrate`/SQL; use Supabase write tools |
| `salon-saas-uiux.md` (frontend) | Read, Grep, Glob, Edit, Write, Bash | `src/app/**` UI, `globals.css` | authorization logic in server actions |
| `salon-saas-qa.md` | Read, Grep, Glob, Edit, Write, Bash | `*.test.ts(x)` | run integration tests / `npm test` locally; delete tests |
| `salon-saas-reviewer.md` (→ reviewer) | Read, Grep, Glob, Bash (read-only by instruction) | nothing | edit files, merge |
| `salon-saas-research.md` | Read, Grep, Glob, WebSearch, WebFetch; `model: haiku` | nothing | send repo content to third parties |

Limits: each agent's `tools` list is an allowlist, so these agents cannot call unlisted MCP tools (e.g. the Supabase connector). "Read-only Bash" and the Prisma/test bans are instructions only; the main session still has every tool. Real enforcement = restrict the Supabase connector and keep `DATABASE_URL` unset.
Isolation: writer agents run in separate git worktrees, one writer per file set; they hand back diffs and short summaries, not transcripts.

## Cloud sessions (phone / PC off) — added 2026-11-05

Owner wants to keep developing from the phone while the PC is off. That needs Claude Code **cloud sessions** (claude.ai/code or the Claude mobile app → Code), which clone `emrtasknn/Salon-SaaS` from GitHub.

Cloud environment settings (owner creates it once at claude.ai/code → environments):
- Repository: `emrtasknn/Salon-SaaS` (Claude GitHub app must have access).
- Network: default/trusted (npm registry needed).
- **Environment variables: none.** Never add `DATABASE_URL`, Supabase keys, Meta tokens or any `.env` value. Without `DATABASE_URL`, integration tests self-skip and nothing can reach pilot.
- Setup script: `DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy npm ci` (the dummy value only lets `prisma generate` run; it never connects and is not exported).

Rules in cloud sessions are the same as local (`CLAUDE.md`, `AGENTS.md`): lint, typecheck, targeted `npx vitest run`, build; integration tests run only in GitHub Actions CI; no migrations, deploys or merges without owner approval. Work lands as branches + PRs; the owner merges from the GitHub app. Task briefs for cloud sessions are kept as GitHub issues so they can be started from the phone ("work on issue #N").

Not available in cloud: the desktop app's Supabase/Vercel connectors, the local Playwright MCP and the built-in browser. Staging/Vercel steps stay with the owner or a desktop session.
