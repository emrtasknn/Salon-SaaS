# Disk Cleanup Policy — Salon SaaS

Goal: free local disk space without losing source, uncommitted work, recovery copies or history.
**Inspecting or preparing is never approval to delete.** Every deletion needs explicit user approval naming the path.

## Before proposing anything

1. Record the target path and which repo/worktree it belongs to (`git worktree list` from the main copy).
2. `git status --short --branch` in that copy; note uncommitted, untracked and stashed work.
3. Measure size and file count; check whether it is reproducible (e.g. `node_modules` from a lockfile, `.next` build output).
4. Determine whether it is the only copy of any work.
5. Write the proposal table below and wait for approval.

## Safe candidates (only after the checks above)

- `node_modules/` in a copy whose `package-lock.json` is committed — restorable with `npm ci`
- `.next/`, `tsconfig.tsbuildinfo` — build output
- Caches proven to hold no user work

## Protected by default

Source, `.git/` and worktree metadata, untracked/user files, `.env*`, migrations, seeds/fixtures, CI config, governance/roadmap/security docs, backups, archives with unknown contents (`*.zip`, `*.patch`), anything outside the repo.

## Git worktrees

Copies whose `.git` is a *file* (not a folder) are linked worktrees. Never delete the folder by hand; that leaves stale metadata. Removal = `git worktree remove <path>` from the main copy, only after confirming no uncommitted work, with approval.

## Local inventory (observed 2026-11-03, classification only — nothing deleted)

Root: `C:\Users\emret\OneDrive\Masaüstü\proje\Salon SaaS\Salon-SaaS\`

| Path | Observed | Classification | Action |
|---|---|---|---|
| `salon-saas/` | Main git copy, branch `staging/webhook`, uncommitted changes, `.env*`, `node_modules`, `.next` | **Active working copy** | Preserve. Only `.next/` is a reproducible candidate. |
| `salon-saas-sync/` | Linked worktree (`.git` file), no `node_modules` | Worktree, status unknown | Preserve until `git worktree list` + status checked |
| `salon-saas-notifications/` | Linked worktree, has `node_modules`, `.next` | Worktree, status unknown | `node_modules`/`.next` are candidates after status check |
| `salon-saas-worktree-sw/` | Linked worktree, has `node_modules` | Worktree, status unknown | Same as above |
| `salon-saas-app/` | Older standalone Next.js scaffold (Oct 4), own `node_modules`, `.next` | Early prototype, not a git copy at top level | Propose only after confirming nothing unique in `src/` |
| `salon-saas-backup-20261028-191015/` | Partial copy: `docs`, `scripts`, `src`, `.agents` | Backup | Preserve; verify contents vs. `main` before any proposal |
| `backup_reconcile_20261029/` | Tool listing shows only `.env.local.example` and `docs/ROADMAP.md.localmod`; Explorer reports ~2.0 GB / 88k files | **Discrepancy unexplained** | Preserve; investigate what holds the 2 GB first |
| `salon-saas-local-changes.patch` | 2.4 KB patch (Oct 22) | Possibly unique user work | Preserve |
| `salon-saas/*_output.txt`, `*-diff.txt`, `*_files.txt`, `tatus --short` | Ad-hoc command output dumps | Untracked user files | Preserve; user may delete or add to `.gitignore` |

## Proposal format

| Path | Size | Reproducible? | Evidence | Proposed action |
|---|---:|---|---|---|

After an approved cleanup: re-check `git status` and `git worktree list`, confirm expected files remain, run lint/typecheck, report actual space recovered.
