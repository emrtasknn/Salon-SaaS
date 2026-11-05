# MVP work packages

Owner-approved on 2026-11-04. Each `WP-XX.md` follows `docs/TASK_TEMPLATE.md` and is the handoff file between agents: every agent appends a short summary under "Agent log" (no transcripts).

## Standard agent workflow
1. `salon-saas-planner` refines the WP file (requirement IDs, file ownership, gates).
2. `salon-saas-research` only for provider, legal or browser questions.
3. `salon-saas-database` drafts schema/migration + RLS + integration-test outline (never applies).
4. ⛔ Owner approval for migration, RLS, tenant model, booking rules, new dependency/provider, notification routing.
5. `salon-saas-backend` ∥ `salon-saas-uiux` implement on separate files.
6. `salon-saas-qa` adds tests (unit locally with `DATABASE_URL` unset; integration in CI only).
7. Main session runs lint + typecheck.
8. `salon-saas-reviewer` reviews; findings loop back to step 5.
9. PR with green CI → ⛔ owner merges.
10. ⛔ Separate approval to apply migrations to staging/pilot or deploy.

Parallel WPs run in separate sessions/worktrees; one writer per file set. Schema line is serial: WP-05 → WP-06 → WP-07 → WP-08 → WP-09 (WP-10 joins it if consent storage needs a migration).

## Packages
| WP | Title | Depends on |
|---|---|---|
| 00 | Documentation hygiene | — |
| 01 | Release governance (`.env.example`, branch protection) | — |
| 02 | P7 external evidence (W11.5/W11.6, shared-sender terms) | external |
| 02b | WhatsApp notifications to tenant admins | — |
| 03 | PWA foundation (W11.10) | — |
| 04 | In-app notifications (ADR-044 phase 1) | — |
| 05 | Rate limiting (Postgres) | — |
| 06 | Status link + customer self-cancel (ADR-044 phase 2) | 05, 00 |
| 07 | Salon settings + active/inactive + wa.me | 06 |
| 08 | Closed dates + staff/admin-created appointments | 07 |
| 09 | Web Push (ADR-044 phase 3 / W11.11) | 03, 08, 02b |
| 10 | KVKK notice + WhatsApp consent | research now; migration slot TBD |
| 11 | QA hardening | 05–09 |
| 12 | Staging + operations | starts now; final rehearsal after 09 |
| 13 | P7 re-run on staging/pilot | 01–12 |
| 14 | P8 go/no-go + P9 closure | 13 |

WP-02b, WP-03, WP-04 and WP-05 files are created by their own sessions.

## Status (2026-11-05) — MVP code complete, gates open
| WP | State | PR |
|---|---|---|
| 00 Docs hygiene | merged | #132 |
| 01 Release governance | `.env.example` merged; branch protection active (owner) | #132 |
| 02 P7 external evidence | **owner: live Meta tests + shared-sender confirmation before production** | — |
| 02b Admin WhatsApp recipients | merged | #133 |
| 02c Shared-sender webhook routing | merged | #138 (design), #145 |
| 03 PWA foundation | merged | #134 |
| 04 In-app notifications | merged | #135 |
| 05 Rate limiting | merged | #137 |
| 06 Status link + self-cancel | merged | #140 |
| 07 Salon settings + status + wa.me | merged | #141 |
| 08 Closed dates + staff/admin-created appointments | merged | #142 |
| 09 Web Push | merged | #144 |
| 10 KVKK notice + WhatsApp opt-in | **owner: approve notice text (+ legal counsel); then implement** | — |
| 11 QA hardening | merged (part 1 #136, #143; part 2 push RLS in #144) | #136, #143, #144 |
| 12 Staging + operations | artifacts merged; **owner: create staging, apply 7 migrations, §4.5 gate** | #139 |
| 13 P7 re-run on staging/pilot | blocked on 02, 10, 12 | — |
| 14 P8 go/no-go + P9 closure | blocked on 13 | — |

Migrations on `main`, none applied anywhere: `20261104100000_rate_limit`, `20261104110000_appointment_access_token`, `20261104120000_tenant_status_contact_phone`, `20261105120000_closure_date`, `20261105130000_web_push_subscription`, `20261105140000_whatsapp_delivery_tenant_resolver`.

Deferred (owner 2026-11-04): DST timezones (MVP locked to Europe/Istanbul), per-tenant WhatsApp senders, reschedule by link.
Added (owner 2026-11-05, PR #183): staff/admin calendar drag-to-move. Follow-up: customer reschedule notification (migration first, WhatsApp template deferred).
