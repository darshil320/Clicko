#!/usr/bin/env node
// Stop hook: typecheck + tests must pass before a session is considered done.
const { execSync } = require('child_process');
const run = (cmd) => {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return null;
  } catch (e) {
    return (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
  }
};
const tc = run('pnpm -w typecheck');
if (tc) {
  console.error('⛔ typecheck failed:\n' + tc.slice(-3000));
  process.exit(2);
}
const t = run('pnpm -w test --run');
if (t) {
  console.error('⛔ tests failed:\n' + t.slice(-3000));
  process.exit(2);
}
process.exit(0);
