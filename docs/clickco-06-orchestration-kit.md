# CLICKCO — CLAUDE CODE ORCHESTRATION KIT
**Complete `.claude/` contents, guard script, agents, skills**
Doc 6 of N · 27 Aug 2026

Copy-paste kit. Session 1 in Doc 7 creates all of this; this file is the reference so you can verify what was created and edit it later without re-deriving it.

---

## 0. Pre-flight — do these before opening Claude Code

```bash
cd ~/path/to
mv clicko clickco                    # product is Clickco. fix before bundle IDs exist.
cd clickco

git init
mkdir -p docs
mv clickco-*.md clickco-*.sql docs/
git add -A
git commit -m "docs: Clickco specification set v1"
git tag spec-v1
```

**Commit the docs before Claude Code touches anything.** An agent working in an unversioned folder can delete your specifications and there is no undo. The tag gives you a guaranteed return point.

Then confirm the doc set is complete — you need **seven** files in `docs/`:

| File | Contains | In your folder? |
|---|---|---|
| `clickco-v0.2-locked-spec.md` | State machine, SLA machine, media pipeline, gap register | ❌ **add this** |
| `clickco-terms-conditions-v2.md` | Every clause the schema constraints enforce | ❌ **add this** |
| `clickco-01-design-pipeline.md` | Design system, Stitch prompts, screen inventory | ✅ |
| `clickco-02-repo-architecture.md` | Monorepo tree, versions, storage port | ✅ |
| `clickco-03-claude-code-build-plan.md` | Prerequisites, sprint plan | ✅ |
| `clickco-04-schema.sql` | Full DDL | ✅ |
| `clickco-05-pricing-engine.md` | Algorithm, rate card, test matrix | ✅ |

Local tooling: Node 22 LTS · pnpm · Docker · Claude Code · Figma desktop app.

---

## 1. `.claude/settings.json`

```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force*)",
      "Bash(git reset --hard*)",
      "Read(./.env)",
      "Read(./**/.env)",
      "Write(./docs/clickco-*)"
    ],
    "ask": [
      "Bash(pnpm add*)",
      "Bash(npm install*)",
      "Bash(docker*)",
      "Bash(git commit*)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "node .claude/scripts/guard.js" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "node .claude/scripts/format.js" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node .claude/scripts/session-end.js" }
        ]
      }
    ]
  }
}
```

`Write(./docs/clickco-*)` in the deny list makes your specifications read-only to the agent. It can read them; it cannot rewrite them. This matters more than it sounds — an agent that "helpfully updates the spec to match the code" destroys your ability to tell whether the code is correct.

---

## 2. `.claude/scripts/guard.js`

The four rules Claude will otherwise drift on, enforced deterministically. Exit code 2 blocks the write.

```js
#!/usr/bin/env node
/**
 * PreToolUse guard. Blocks writes that violate Clickco's architectural rules.
 * Exit 0 = allow, exit 2 = block with the message on stderr.
 */
const fs = require('fs');

// --- read the hook payload -------------------------------------------------
let payload = {};
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch { /* fall through to argv */ }

const input = payload.tool_input || {};
const filePath = input.file_path || input.path || process.argv[2];
if (!filePath) process.exit(0);

// content may arrive as `content` (Write) or `new_string` (Edit)
let content = input.content ?? input.new_string ?? null;
if (content == null) {
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { process.exit(0); }
}

const rel = filePath.replace(process.cwd() + '/', '');
const violations = [];
const isCode = /\.(ts|tsx|js|jsx)$/.test(rel);
const isTest = /\.(test|spec)\.|__tests__|__mocks__/.test(rel);

// --- RULE 1: no cross-feature imports -------------------------------------
const featureMatch = rel.match(/(?:src\/)?features\/([^/]+)\//);
if (featureMatch && isCode) {
  const own = featureMatch[1];
  const importRe = /from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g;
  let m;
  while ((m = importRe.exec(content))) {
    const spec = m[1] || m[2];
    const other = spec.match(/features\/([^/'"]+)/);
    if (other && other[1] !== own) {
      violations.push(
        `Cross-feature import: features/${own} may not import from features/${other[1]}.\n` +
        `  → move the shared code to src/shared/ or a package.\n` +
        `  offending import: ${spec}`
      );
    }
  }
}

// --- RULE 2: no hardcoded colours outside design-tokens -------------------
if (isCode && !rel.includes('packages/design-tokens') && !isTest) {
  const hex = content.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const rgb = content.match(/\brgba?\(\s*\d+\s*,/g) || [];
  const found = [...new Set([...hex, ...rgb])];
  if (found.length) {
    violations.push(
      `Hardcoded colour(s) ${found.slice(0, 5).join(', ')} in ${rel}.\n` +
      `  → import from @clickco/design-tokens. If the token is missing, ask instead of inventing one.`
    );
  }
}

// --- RULE 3: storage SDKs only inside the adapter -------------------------
const STORAGE_SDKS = ['googleapis', '@google-cloud/storage', 'google-auth-library',
                      '@aws-sdk/client-s3', '@aws-sdk/lib-storage'];
if (isCode && !rel.includes('infra/storage/adapters')) {
  for (const sdk of STORAGE_SDKS) {
    if (new RegExp(`['"]${sdk.replace(/[/@]/g, '\\$&')}`).test(content)) {
      violations.push(
        `Storage SDK "${sdk}" imported in ${rel}.\n` +
        `  → all storage access goes through StoragePort. Adapters live in ` +
        `apps/api/src/infra/storage/adapters/ only.`
      );
    }
  }
}

// --- RULE 4: money must be integer paise ---------------------------------
if (isCode && !isTest) {
  const MONEY = /(paise|amount|price|total|payout|balance|advance|subtotal|gst|refund|fee)/i;

  // decimal literal assigned to a money-named thing
  const decimalAssign =
    new RegExp(`\\b\\w*${MONEY.source}\\w*\\s*[:=]\\s*-?\\d+\\.\\d+`, 'gi');
  const badDecimals = content.match(decimalAssign) || [];

  // float coercions near money
  const floatCalls = [];
  for (const re of [/parseFloat\s*\(([^)]*)\)/g, /Number\s*\(([^)]*)\)/g,
                    /toFixed\s*\(/g, /Math\.(round|floor|ceil)\s*\(([^)]*)\)/g]) {
    let m;
    while ((m = re.exec(content))) {
      const window = content.slice(Math.max(0, m.index - 60), m.index + m[0].length + 20);
      if (MONEY.test(window)) floatCalls.push(m[0]);
    }
  }

  if (badDecimals.length || floatCalls.length) {
    violations.push(
      `Float arithmetic on money in ${rel}: ` +
      `${[...badDecimals, ...floatCalls].slice(0, 4).join(', ')}\n` +
      `  → money is BIGINT/bigint PAISE. ₹8,500 is 850000n. Use roundHalfUp() ` +
      `from @clickco/utils. No parseFloat, no toFixed, no decimals.`
    );
  }
}

// --- RULE 5: the schema file is the source of truth ----------------------
if (/schema\.(ts|prisma)$/.test(rel) && /CREATE TABLE|createTable/i.test(content)) {
  const declaresTables = (content.match(/pgTable\s*\(/g) || []).length;
  if (declaresTables > 0 && !rel.includes('infra/db')) {
    violations.push(
      `Table definitions outside apps/api/src/infra/db/. docs/clickco-04-schema.sql ` +
      `is the source of truth; the ORM mirrors it and never redefines it.`
    );
  }
}

// --- RULE 6: no secrets ---------------------------------------------------
const SECRET_PATTERNS = [
  [/rzp_(live|test)_[A-Za-z0-9]{10,}/, 'Razorpay key'],
  [/sk_live_[A-Za-z0-9]{10,}/, 'secret key'],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, 'private key'],
  [/"private_key"\s*:\s*"-----BEGIN/, 'GCP service-account key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
];
for (const [re, label] of SECRET_PATTERNS) {
  if (re.test(content)) {
    violations.push(`Possible ${label} in ${rel}. Secrets never enter the repo.`);
  }
}

// --- verdict -------------------------------------------------------------
if (violations.length) {
  console.error('\n⛔ Clickco guard blocked this write:\n');
  violations.forEach((v, i) => console.error(`${i + 1}. ${v}\n`));
  console.error('Fix the above, or tell Darshil why the rule should change.\n');
  process.exit(2);
}
process.exit(0);
```

### `.claude/scripts/format.js`

```js
#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
let p = {};
try { p = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
const f = (p.tool_input || {}).file_path;
if (!f || !/\.(ts|tsx|js|jsx|json|css)$/.test(f)) process.exit(0);
try { execSync(`pnpm biome check --write "${f}"`, { stdio: 'ignore' }); } catch {}
process.exit(0);
```

### `.claude/scripts/session-end.js`

```js
#!/usr/bin/env node
// Stop hook: typecheck + tests must pass before a session is considered done.
const { execSync } = require('child_process');
const run = (cmd) => {
  try { execSync(cmd, { stdio: 'pipe' }); return null; }
  catch (e) { return (e.stdout?.toString() || '') + (e.stderr?.toString() || ''); }
};
const tc = run('pnpm -w typecheck');
if (tc) { console.error('⛔ typecheck failed:\n' + tc.slice(-3000)); process.exit(2); }
const t = run('pnpm -w test --run');
if (t) { console.error('⛔ tests failed:\n' + t.slice(-3000)); process.exit(2); }
process.exit(0);
```

> Add the Stop hook only from Session 3 onward. Before packages exist, `pnpm typecheck` fails on an empty repo and blocks every session.

---

## 3. Subagents

### `.claude/agents/spec-auditor.md`
Session 0's whole job. Reads all seven docs in one isolated context and cross-checks them.

```markdown
---
name: spec-auditor
description: Cross-checks the Clickco specification set for contradictions, gaps and unresolved decisions. Use once at project start, and again whenever a spec document changes.
tools: Read, Grep, Glob
model: opus
---

You audit the Clickco specification set for internal consistency. You do not
write application code and you never edit the docs/clickco-* files.

Read all of these before reporting:
  docs/clickco-v0.2-locked-spec.md
  docs/clickco-terms-conditions-v2.md
  docs/clickco-01-design-pipeline.md
  docs/clickco-02-repo-architecture.md
  docs/clickco-03-claude-code-build-plan.md
  docs/clickco-04-schema.sql
  docs/clickco-05-pricing-engine.md

Cross-check specifically:

A. STATE MACHINE
   Every value in the booking_status enum (schema §1) appears in the lifecycle
   in v0.2 §6, and vice versa. No orphans in either direction.

B. MONEY
   Every monetary field in the schema is BIGINT. No NUMERIC, DECIMAL or REAL
   anywhere near an amount. Percentages are integer basis points.

C. RATE CARD CONSISTENCY
   The per-hour rates in doc 05 §5, multiplied by the 2-hour minimum, equal
   the headline prices quoted in doc 01's Stitch prompts and anywhere v0.2
   mentions a price. Report every mismatch with both figures.

D. SLA
   The sla_kind enum (schema §1), the clock ladder in v0.2 §7, and the
   delivery commitments in T&C §5 describe the same timings. T0 is
   CHECKED_OUT everywhere, never booking creation.

E. RETENTION
   RAW = 7 days, JPEG = 30 days, both measured from DELIVERY not shoot.
   Consistent across v0.2, T&C §5.4, and media_assets.purge_after semantics.

F. EMERGENCY
   Five bands with identical multipliers, guarantee status and capture
   behaviour across v0.2 §8, doc 05 §5, T&C §3.7, and the emergency_band enum.

G. T&C ↔ SCHEMA COVERAGE
   Every T&C clause that implies stored data has a column. Check at minimum:
   peak season (§3.2) → festival_calendar.is_peak_season;
   15-minute waiting grace (§2.6) → extension_rates.waiting_grace_minutes;
   retention (§5.4) → media_assets.purge_after;
   promotional opt-IN (§9.4) → users.promo_use_consent;
   equipment liability cap (§8.2) → is there anywhere to record a claim?
   Grievance Officer (§12) → is there a support/dispute surface?

H. KNOWN CONTRADICTIONS — verify these are real and report the resolution
   1. Doc 02 recommends Prisma; schema §15 reverses that to Drizzle.
      Correct answer: Drizzle. Doc 02 is stale on this point.
   2. Doc 02 §1 supersedes v0.2's "on-site proxy upload" requirement.
      Correct answer: web portal is the primary upload path; the Pro app
      uploads only proof shots.
   3. v0.2 §2 resolves "pan-India" to gated fulfilment in 3 cities.

I. UNRESOLVED DECISIONS
   List every decision the docs mark as open, with the document reference and
   what it blocks. At minimum: GST inclusive vs exclusive; rate card sign-off;
   festival dates for FY26-27 and FY27-28; Signature quoting method; Clickco
   Edit pricing; legal entity name; jurisdiction city; equipment liability cap.

WRITE THREE FILES, and nothing else:

1. docs/SPEC-AUDIT.md
   Findings as a table: id / severity (BLOCKER, MAJOR, MINOR) / area /
   documents in conflict / description / recommended resolution.
   BLOCKER means code cannot be written correctly without a decision.

2. docs/DOMAIN.md
   The canonical domain reference, synthesised from the specs. This becomes
   the file every future session reads. It must contain:
   - Entity glossary, one line each
   - The complete booking state machine as a transition table:
     from → to, trigger, actor, side effects, emitted event
   - The domain event catalogue with payload shapes
   - The SLA clock ladder: kind, anchor, offset, on-breach behaviour
   - Money rules, stated as absolutes
   - Invariants, numbered, each phrased as something that must never happen

3. docs/OPEN-DECISIONS.md
   One row per unresolved decision: id / question / options / recommendation /
   what it blocks / owner (Darshil unless stated).

Report a one-page summary to the main thread: BLOCKER count, MAJOR count,
and the single most important thing Darshil must decide first.

Do not soften findings and do not invent findings to appear thorough. If an
area is clean, say it is clean.
```

### `.claude/agents/domain-guardian.md`

```markdown
---
name: domain-guardian
description: Reviews changes to bookings, pricing, dispatch, ledger, sla or payments modules against docs/DOMAIN.md. Use after any change in those modules, before committing.
tools: Read, Grep, Glob
model: opus
---

You are the domain integrity reviewer for Clickco. Read docs/DOMAIN.md first,
every single time — do not work from memory of it.

Check the changed code for:
 1. Illegal state transitions not present in the DOMAIN.md transition table
 2. Money as anything other than integer paise / bigint
 3. Price computed anywhere outside the pricing module
 4. A price snapshot mutated after creation
 5. Direct writes to another module's tables
 6. A state transition that does not write to booking_status_events AND
    insert a domain_events row in the SAME transaction (outbox pattern)
 7. SLA clocks anchored anywhere other than actual_check_out
 8. Ledger rows updated or deleted; unbalanced ledger transactions
 9. Missing idempotency on a money-mutating path
10. Surge or emergency multipliers applied to addons or travel (they must not be)
11. Overlapping festival multipliers multiplied instead of MAX()

Report as a table: severity / file:line / invariant violated / suggested fix.
Never edit files. If clean, say so plainly.
```

### `.claude/agents/schema-guardian.md`

```markdown
---
name: schema-guardian
description: Verifies the ORM schema and migrations faithfully mirror docs/clickco-04-schema.sql. Use after any database schema or migration change.
tools: Read, Grep, Glob, Bash
model: opus
---

docs/clickco-04-schema.sql is the SOURCE OF TRUTH. The ORM mirrors it. The ORM
never defines it.

For every changed table or migration, verify against the SQL file:
 - column names, types and nullability match exactly
 - all CHECK constraints present
 - all partial indexes present, with identical WHERE clauses
 - EXCLUDE USING gist on assignments and photographer_blocks present
 - append-only triggers present on ledger_entries, audit_logs,
   booking_status_events, assignment_events,
   photographer_application_events
 - the DEFERRABLE constraint trigger on ledger_entries present
 - forbid_update trigger on booking_price_snapshots present
 - allocate_invoice_number() function present and atomic
 - generated column bookings.scheduled_end present
 - geography(Point, 4326) columns are real geography, not text or jsonb

Report anything missing or weakened as a BLOCKER. Losing a constraint silently
is how correctness bugs reach production.
```

### `.claude/agents/contract-checker.md`

```markdown
---
name: contract-checker
description: After any API surface change, verifies every consumer still type-checks against packages/contracts. Use after changing a controller, DTO or contract schema.
tools: Read, Grep, Glob, Bash
model: sonnet
---

packages/contracts is the single source of truth for domain types across
api, client, pro, admin, portal and web.

For the changed endpoint or schema:
 1. Find every consumer with Grep across apps/
 2. Confirm each imports its types from @clickco/contracts, never redefining
 3. Run `pnpm -w typecheck` and report failures
 4. Flag any locally declared interface that duplicates a contract type
 5. Flag any `any`, `as unknown as`, or non-null assertion added to make
    something compile

Report: file / issue / fix. Do not edit.
```

### `.claude/agents/security-reviewer.md`

```markdown
---
name: security-reviewer
description: Reviews any change touching auth, payments, uploads, delivery links, admin endpoints or personal data. Use before committing such changes.
tools: Read, Grep, Glob
model: opus
---

Review for:
 - AuthZ: every endpoint has an explicit guard. Ownership checked, not just
   authentication. IDOR on booking ids, delivery tokens, payout ids,
   photographer ids.
 - Idempotency on all money-mutating endpoints
 - Webhook signature verification before any state change; replay protection
   via payment_webhook_events unique index
 - Delivery links: opaque tokens, expiry enforced server-side, revocation
   honoured, no provider URL ever returned directly to a client
 - Secrets: nothing in code, nothing in EXPO_PUBLIC_*, nothing logged
 - PII: Aadhaar numbers must NEVER be stored. photographer_documents access
   restricted and audited. Bank account numbers encrypted, only last4 in
   plaintext.
 - Masked calling: real phone numbers never returned to the other party
 - Admin: city-scoped RBAC enforced server-side, never client-side only
 - SQL injection in any $queryRaw / sql`` template
 - Rate limiting on OTP endpoints; OTP codes hashed, never stored plain

Report: severity / file:line / issue / fix. Do not edit.
```

### `.claude/agents/test-writer.md`

```markdown
---
name: test-writer
description: Writes the test suite for a module before implementation exists. Use when starting any module in pricing, bookings, dispatch, ledger, sla or payments.
tools: Read, Write, Bash, Grep, Glob
model: opus
---

You write tests. You never write or modify implementation code.

Read docs/DOMAIN.md and the relevant spec document first. For the pricing
module specifically, docs/clickco-05-pricing-engine.md §10 lists 82 required
cases — implement all of them.

Rules:
 - Vitest. Arrange-Act-Assert. One behaviour per test.
 - Test boundaries explicitly, both sides. Lead time of exactly 3.0 hours AND
   2.999 hours. 21:59 AND 22:00. Exactly 15.00 km AND 15.01 km.
 - Money assertions in paise, as integers or bigint. Never a decimal.
 - No mocking of the thing under test. Mock only I/O at the edges.
 - Tests must fail before implementation exists. If a test passes against an
   empty module, it is asserting nothing — rewrite it.
 - Name tests as sentences: "rejects a booking under the 2 hour minimum".

Print the full list of test names before writing files and wait for approval.
```

### `.claude/agents/design-verifier.md`

```markdown
---
name: design-verifier
description: Screenshots a built screen and diffs it against its Figma frame. Use after building or changing any UI screen.
tools: Read, Bash, Glob
model: sonnet
---

Claude Code cannot see what it built. You close that loop.

 1. Start the app if needed; navigate to the route under test
 2. Screenshot at 393×852 (iPhone 15 Pro) and 360×800 (common Android)
 3. Read the Figma frame via the Figma MCP get_design_context tool
 4. Compare: vertical spacing against the 4pt scale, font sizes and weights,
    colour token usage, border radii, tap target sizes (min 44pt),
    safe-area insets, and that all four states exist (loading, empty, error,
    loaded)

Report a table: element / expected / actual / severity. Do not edit code.
An empty table is the only acceptable "done".
```

---

## 4. Skills

### `.claude/skills/clickco-money/SKILL.md`

```markdown
---
name: clickco-money
description: How Clickco represents and computes money. Load whenever code touches an amount, price, total, payout, GST, refund, or ledger entry.
---

# Money in Clickco

## Representation
Integer paise. Always. ₹8,500.00 is `850000`.
- Postgres: BIGINT
- TypeScript: `bigint` for arithmetic, `number` at API boundaries where the
  value is known to fit (it always will — ₹9,00,00,00,000 is within 2^53)
- Zod: `z.number().int()` in packages/contracts

Never: float, DECIMAL, NUMERIC, parseFloat, toFixed, or a decimal literal.

## Percentages
Integer basis points. 18% is `1800`. 62.5% is `6250`.

## Rounding
One function, from @clickco/utils:

```ts
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (2n * denominator);
}
```

Half-up, not banker's. Round once per line item, then sum. Never round a total
after summing unrounded lines.

## GST
Exclusive by default (`pricing_rulesets.prices_include_gst = false`).
On the inclusive branch, derive the tax by SUBTRACTION, never by rounding
both base and tax independently — that produces a total off by a paise and a
GST return that will not reconcile.

## Multipliers do not apply to everything
Base amount takes: category uplift × emergency × surge × night × weekend.
Addons and travel take NONE of them.
Overlapping festival multipliers take MAX(), never the product.

## Display
Format only at the UI edge, via `formatINR()` from @clickco/utils. Indian
grouping: ₹1,20,000 not ₹120,000.

## Ledger
Double-entry, append-only. Every transaction balances within its txn_id or the
deferred constraint trigger rejects it. Balances are derived by query, never
stored in a column.
```

### `.claude/skills/clickco-screen/SKILL.md`

```markdown
---
name: clickco-screen
description: The procedure for building a mobile screen in the Clickco client or pro app from a Figma frame. Load when creating or modifying any screen under apps/client/app or apps/pro/app.
---

# Building a Clickco screen

Follow every step. Do not skip step 2 or step 8.

1. Read the Figma frame via the Figma MCP `get_design_context` tool.

2. Check that every primitive you need already exists in packages/ui.
   If one is missing, STOP and tell Darshil. Never create a local one-off
   component — that is how a codebase ends up with four Buttons.

3. Route files under `app/` compose only. All logic lives in
   `src/features/<feature>/`.

4. Server state via a TanStack Query hook in `features/<feature>/hooks.ts`.
   Types from @clickco/contracts. Never an inline fetch.
   Client-only state via Zustand, in `features/<feature>/store.ts`.

5. Styling with NativeWind classes from our Tailwind preset only.
   No inline hex, no magic numbers, no StyleSheet mixed in.

6. Handle all four states explicitly: loading (skeleton, not a spinner),
   empty (illustration slot + one action), error (retry affordance), loaded.

7. SafeAreaView insets top and bottom. Primary CTA pinned to the bottom with
   a 16px gap above the inset. Minimum 44pt tap targets.

8. Delegate to the design-verifier subagent. Fix everything it reports.
   Repeat until its table is empty. A screen is not done until then.

## Content rules
₹ with Indian grouping. Real Indian names and cities in any placeholder.
Dates DD MMM. Times 12-hour with am/pm. No lorem ipsum, ever.
```

### `.claude/skills/clickco-module/SKILL.md`

```markdown
---
name: clickco-module
description: The procedure and skeleton for creating a NestJS module in apps/api. Load when adding or restructuring any backend module.
---

# Creating a Clickco API module

## Order of work
1. Read docs/DOMAIN.md for the invariants this module owns.
2. If the module is pricing, bookings, dispatch, ledger, sla or payments:
   delegate to test-writer FIRST. Tests before implementation, no exceptions.
3. Add or confirm the Zod schemas in packages/contracts.
4. Then implement.

## Structure
```
modules/<name>/
├── <name>.module.ts
├── <name>.controller.ts       thin. validate, delegate, return.
├── <name>.service.ts          domain logic. the only place decisions happen.
├── repositories/
│   └── <name>.repository.ts   all DB access for this module
├── dto/                       re-exports from @clickco/contracts, never new types
├── events/                    domain event definitions
└── __tests__/
```

## Rules
- Modules communicate via injected services or domain events. Never query
  another module's tables.
- Validation through ZodValidationPipe using contracts schemas.
- Every state transition writes booking_status_events AND inserts a
  domain_events row in the same transaction. Outbox pattern, not fire-and-forget.
- Every admin mutation passes AuditLogInterceptor.
- Every money-mutating endpoint carries @Idempotent().
- Scheduled work is a BullMQ processor in jobs/, registered in infra/queues/.
  Never setTimeout, never node-cron.
- Geo queries use raw SQL with PostGIS, isolated in dispatch/repositories/.
- Storage access only through StoragePort.

## Before finishing
Delegate to domain-guardian. If the module touches auth, payments, uploads or
delivery links, also delegate to security-reviewer.
```

---

## 5. Root `CLAUDE.md`

Keep it this short. Detail lives in skills and DOMAIN.md.

```markdown
# CLICKCO

On-demand professional photography booking platform for India.
Monorepo: Turborepo + pnpm. Four surfaces + API. See docs/clickco-02-repo-architecture.md.

## Read before working
- docs/DOMAIN.md — before ANY work on bookings, pricing, dispatch, ledger, sla, payments
- docs/clickco-04-schema.sql — the schema source of truth. The ORM mirrors it; it never defines it.
- docs/OPEN-DECISIONS.md — if your task depends on an open row, STOP and ask.

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
```

---

## 6. Pinned versions

`.claude/skills/clickco-module/reference-versions.md` — so Claude never has to guess or search.

```
Expo SDK 56 · React Native 0.85 · React 19.2 · expo-router v6
nativewind 4.x · @tanstack/react-query v5 · zustand 5.x
react-hook-form + zod · react-native-mmkv · react-native-reanimated 4.x

NestJS 11 · PostgreSQL 16 + PostGIS · Drizzle ORM · Redis 7 · BullMQ
Next.js App Router (current stable) · shadcn/ui · @tanstack/react-table v8
Node 22 LTS · pnpm · Turborepo · TypeScript 5.x strict · Biome
Vitest · Playwright · Maestro
```
