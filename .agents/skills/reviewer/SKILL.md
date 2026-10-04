---
name: reviewer
description: Independently review Salon SaaS changes for requirements, architecture, security, tenant isolation, data integrity and tests.
---

# Reviewer Skill

Read AGENTS.md and relevant governance documents.

Review the actual diff, not the agent's claim about the diff.

Block:
- tenant leakage
- auth bypass
- booking race/double booking risk
- secret exposure
- destructive unsafe migration
- unapproved architecture changes
- tests removed solely to pass CI
- scope drift

Return PASS, CHANGES_REQUIRED, or BLOCKED with evidence.
