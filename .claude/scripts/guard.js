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
} catch {
  /* fall through to argv */
}

const input = payload.tool_input || {};
const filePath = input.file_path || input.path || process.argv[2];
if (!filePath) process.exit(0);

// content may arrive as `content` (Write) or `new_string` (Edit)
let content = input.content ?? input.new_string ?? null;
if (content == null) {
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    process.exit(0);
  }
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
          `  offending import: ${spec}`,
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
        `  → import from @clickco/design-tokens. If the token is missing, ask instead of inventing one.`,
    );
  }
}

// --- RULE 3: storage SDKs only inside the adapter -------------------------
const STORAGE_SDKS = [
  'googleapis',
  '@google-cloud/storage',
  'google-auth-library',
  '@aws-sdk/client-s3',
  '@aws-sdk/lib-storage',
];
if (isCode && !rel.includes('infra/storage/adapters')) {
  for (const sdk of STORAGE_SDKS) {
    if (new RegExp(`['"]${sdk.replace(/[/@]/g, '\\$&')}`).test(content)) {
      violations.push(
        `Storage SDK "${sdk}" imported in ${rel}.\n` +
          `  → all storage access goes through StoragePort. Adapters live in ` +
          `apps/api/src/infra/storage/adapters/ only.`,
      );
    }
  }
}

// --- RULE 4: money must be integer paise ---------------------------------
if (isCode && !isTest) {
  const MONEY = /(paise|amount|price|total|payout|balance|advance|subtotal|gst|refund|fee)/i;

  // decimal literal assigned to a money-named thing
  const decimalAssign = new RegExp(`\\b\\w*${MONEY.source}\\w*\\s*[:=]\\s*-?\\d+\\.\\d+`, 'gi');
  const badDecimals = content.match(decimalAssign) || [];

  // float coercions near money
  const floatCalls = [];
  for (const re of [
    /parseFloat\s*\(([^)]*)\)/g,
    /Number\s*\(([^)]*)\)/g,
    /toFixed\s*\(/g,
    /Math\.(round|floor|ceil)\s*\(([^)]*)\)/g,
  ]) {
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
        `from @clickco/utils. No parseFloat, no toFixed, no decimals.`,
    );
  }
}

// --- RULE 5: the schema file is the source of truth ----------------------
if (/schema\.(ts|prisma)$/.test(rel) && /CREATE TABLE|createTable/i.test(content)) {
  const declaresTables = (content.match(/pgTable\s*\(/g) || []).length;
  if (declaresTables > 0 && !rel.includes('infra/db')) {
    violations.push(
      `Table definitions outside apps/api/src/infra/db/. docs/clickco-04-schema.sql ` +
        `is the source of truth; the ORM mirrors it and never redefines it.`,
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
