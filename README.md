# Salon SaaS

Multi-tenant SaaS platform for salons, barbers and beauty centers.

This repository is being bootstrapped with the Project Governance and Agent Office OS before application development begins.

## Quality gates

Run from the repository root after `npm ci`:

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript (tsc --noEmit)
npm test            # Vitest tests
npm run build       # Next.js production build
```

All four gates must pass locally and in CI (`.github/workflows/ci.yml`) before merge.

