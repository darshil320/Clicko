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

## Design

Sources of truth, in this order. A design skill never overrides them:
1. @clickco/design-tokens — every colour, size, radius, shadow and duration. tokens.test.ts pins it to the docs.
2. docs/DESIGN.md — base rules every surface keeps: type, spacing, radius, components, content, accessibility.
3. docs/DESIGN-LIGHT.md (ADR-0017) — client, pro, portal and admin. docs/DESIGN-DAYLIGHT.md (ADR-0018) — apps/web only.
4. packages/ui (client, pro) and packages/ui-web (admin) — the only component sources.

Design skills (~/.claude/skills), by job:
- interface-design — app screens in client, pro, admin, portal. The docs above are its system.md:
  never create `.interface-design/`, never rename tokens. Mobile screens still follow clickco-screen.
- hallmark — apps/web only, and only when named: `/hallmark audit <path>`, then `/hallmark redesign <path>`.
  DESIGN-DAYLIGHT.md is its locked DESIGN.md. Map its picks onto design-tokens; never write its own
  tokens.css. Never run imagegen.mjs or ship a generated photo: real or licensed photos only.
  Lint the running page: `node ~/.claude/skills/hallmark/scripts/sloplint.mjs <url> --render`.
- better-typography — review pass on every surface after layout work. Tabular numbers on prices, timers,
  SLA countdowns and counts (React Native: `fontVariant: ['tabular-nums']`). It never picks a typeface:
  type is fixed by DESIGN.md (apps) and ADR-0022 (web).
- hue — generates design-language skills. Feed it the local codebase only (tokens + the docs above):
  extract, never invent. Output to .claude/skills/clickco-<theme>/, then `node ~/.claude/skills/hue/scripts/validate.mjs <folder>`.
- clickco-design-pass — runs the above, in order, for one surface. Start design improvement work there.

Skill-vs-doc conflicts: the doc wins until an ADR changes it; propose the ADR, never diverge silently.
ADR-0028 settled the website's: no eyebrows, sentence-case labels, one accent phrase (home hero only),
arrow disc on the amber primary only, no middle-dot meta strings, each proof fact once per page.
Hallmark's dash ban and section budget were not adopted.

Never ship these generated-site tropes: painted gradient "photos", pulsing-dot chips, image pills inside
headlines, floating glass status cards, camera-spec mono captions, corner marks, blurry radial glows, word
marquees, invented metrics, testimonials or logos.

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
