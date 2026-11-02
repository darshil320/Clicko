---
name: clickco-design-pass
description: Audit and improve the design of one Clickco surface (web, client, pro, admin or portal) with the hallmark, interface-design, better-typography and hue skills, inside the project's tokens and kits. Run only when asked.
argument-hint: "<web | client | pro | admin | portal> [path]"
disable-model-invocation: true
---

# Design pass: $ARGUMENTS

Improve how one surface looks and reads without breaking the system it is built on. Read the Design
section of CLAUDE.md first; its source order and conflict list bind every step below.

## 0. Ground

- Surface doc: web → docs/DESIGN-DAYLIGHT.md. client, pro, admin, portal → docs/DESIGN-LIGHT.md.
  Every surface → docs/DESIGN.md for type, components, content and accessibility.
- Kit: client, pro → packages/ui. admin → packages/ui-web. web, portal → their own components on
  @clickco/design-tokens. List what exists before proposing anything.
- Run it and look before judging. web: `.claude/launch.json` (port 4321). admin: 3001. portal: 3002.
  client, pro: Expo, screenshots the way design-verifier takes them.
  Capture each screen at 390 wide, plus 1280 x 800 and 1920 for web, admin and portal.
  Playwright MCP locked or no puppeteer-core? `node .claude/skills/clickco-design-pass/cdp-shot.mjs`
  drives headless Chrome with real device emulation (Chrome's own `--screenshot` cannot go
  under ~500 wide). Use `reduced` and `chunk` for full pages: scroll reveals and lazy images
  otherwise leave blank bands that look like bugs.
- No `.claude/skills/clickco-<theme>/` yet for this theme? Offer to generate it with `/hue` from the
  local codebase (tokens + surface doc) before the audit. Extract only; validate with its script.

## 1. Audit (read-only, no edits)

- web: `/hallmark audit <path>`, then `node ~/.claude/skills/hallmark/scripts/sloplint.mjs <url> --render`.
  sloplint cannot read CSS inside TypeScript templates (apps/web/src/styles): its 26a, 26b and
  34 findings there are false until you grep the styles. Its `--kept` "fields" are any JSX
  `name=` prop, so an Icon's `name="check"` counts. Gate 19 (dashes) is waived by ADR-0028.
- client, pro, admin, portal: interface-design's audit. Name the human, the verb and the feel per
  screen; find where defaults won (type, navigation, data, states).
- Every surface: better-typography review, then the trope list in CLAUDE.md.

Merge into one list. Each finding: screen, `file:line`, what is wrong, the rule it breaks (doc §,
skill gate number, or a11y), and one bucket:
- **fix** — doable with existing tokens and kit components
- **primitive** — needs a component the kit lacks (stop and ask; never a one-off)
- **ADR** — conflicts with a design doc (draft the ADR; the doc wins until it lands)

## 2. Plan, then wait

Show the list ranked by user impact (hero and booking flow first), the screens each fix touches and
the commit split. Wait for approval: CLAUDE.md's more-than-3-files rule applies.

## 3. Fix

- One screen or section per commit. Conventional commits (`style:` or `fix:`).
- Tokens and kit only: no raw colour, size, radius, shadow or duration.
- Money stays integer paise formatted by the shared formatter (clickco-money). Content rules from
  DESIGN.md: ₹ with lakh grouping, real Indian names and cities, DD MMM, 12-hour am/pm.
- Real or licensed photos only. A missing photo is a labelled slot, never a generated image.
- Keep all four states on every app screen: loading skeleton, empty, error with retry, loaded.

## 4. Verify each commit

- design-verifier until its table is empty.
- web: sloplint `--render` until no `FAIL`; every remaining `REFLEX` fixed or waived with a reason.
- Re-screenshot at the same sizes and show before and after side by side.
- `pnpm --filter @clickco/<app> typecheck` and its tests.

## 5. Close

Add a line per shipped fix and every open ADR or missing primitive to docs/PROGRESS.md.
