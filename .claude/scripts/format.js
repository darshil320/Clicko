#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
let p = {};
try {
  p = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {}
const f = (p.tool_input || {}).file_path;
if (!f || !/\.(ts|tsx|js|jsx|json|css)$/.test(f)) process.exit(0);
try {
  execSync(`pnpm biome check --write "${f}"`, { stdio: 'ignore' });
} catch {}
process.exit(0);
