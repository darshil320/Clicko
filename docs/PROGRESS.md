# PROGRESS

Updated at the end of every session. Newest first.

## 2026-10-21 · Sprint 0 · session 1
**Shipped**
- Consolidated plan (`PLAN.md`), ADRs 0001–0008, OPEN-DECISIONS status, schema addendum 0002 (SA-01/02)
- `.claude/` kit: settings, guard/format/session-end, 7 agents, 3 skills; scoped CLAUDE.md files
- Root workspace, packages (config, utils, contracts, design-tokens, stubs), Docker compose, API boot skeleton + migration runner

**Stubbed / not started**
- `apps/client`, `pro`, `admin`, `portal`, `web` are placeholder workspaces (scaffolded in their sprints)
- Legal-pages site — blocked on OD-06 / OD-09

**Next**
- Darshil: answer PLAN §8 Q1–Q4; file long-lead items B1–B11
- S0 close-out: legal-pages site (Stop hook already enabled)
- S1: auth (phone OTP) + serviceability + `drizzle-kit pull`

**Found this session**
- SA-11 BLOCKER: spec schema could not be applied to Postgres (`scheduled_end` generated column). Patched via `spec-patches.ts`; fold into schema v2.
- Host already runs Postgres on 5432 → Docker DB is on **5433**.

**Known issues**
- Festival dates for lunar festivals are PROVISIONAL (ADR-0005) — verify before T&C publish
