# CLICKCO

On-demand professional photography booking platform for India.
Monorepo: Turborepo + pnpm. Four surfaces + API. See docs/clickco-02-repo-architecture.md.

## Read before working

- docs/DOMAIN.md — before ANY work on bookings, pricing, dispatch, ledger, sla, payments
- docs/clickco-04-schema.sql — the schema source of truth. The ORM mirrors it; it never defines it.
- docs/OPEN-DECISIONS.md + docs/DECISIONS/ — if your task depends on an open row, STOP and ask.
- docs/PLAN.md — sprint scope and gates. docs/PROGRESS.md — where the last session stopped.

## Non-negotiable

1. Money is integer paise. See the clickco-money skill.
2. Domain types come from packages/contracts. Never redefine one locally.
3. No hardcoded colours, spacing or font sizes. Use @clickco/design-tokens.
4. Never create a one-off UI component. Compose from packages/ui.
   If a primitive is missing, stop and ask.
5. features/X must not import from features/Y.
6. Every money-mutating endpoint is idempotent.
7. Every state transition emits a domain event via the outbox, in the same transaction.
8. Storage access only through StoragePort.
9. docs/clickco-*.md and .sql are READ-ONLY. Never edit a specification.

## Working style

- Plan first. Any task touching more than 3 files: write the plan, wait for approval.
- Test-first in pricing, bookings, dispatch, ledger, sla, payments. Delegate to test-writer.
- After backend work in those modules: delegate to domain-guardian.
- After UI work: delegate to design-verifier.
- After auth/payments/upload/link work: delegate to security-reviewer.
- After schema work: delegate to schema-guardian.
- Update docs/PROGRESS.md at the end of every session.
- One concern per commit. Conventional commits.
- Definition of done: docs/PLAN.md §4. A green typecheck is not a working feature.

## Stop and ask when

- A spec is ambiguous or two docs disagree
- The task depends on a row in OPEN-DECISIONS.md
- You need a dependency not already in package.json
- You want to change a pinned version
- A guard hook blocks you and you believe the rule is wrong
- You are about to write a workaround instead of a fix

## Never

Never MongoDB, Redux, AsyncStorage (use MMKV), or `newArchEnabled: false`.
Never commit a secret. Never store an Aadhaar number.
Never edit a specification document to match the code.
