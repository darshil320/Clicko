#!/usr/bin/env node
// Stop hook: typecheck + tests must pass before a session is considered done.
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
// The hook's shell may not carry the user's PATH: put the pinned Node 22 (and its pnpm) first.
const NODE22_BIN = path.join(os.homedir(), '.nvm/versions/node/v22.19.0/bin');
// pnpm itself lives in the user's pnpm home (or an older nvm Node); Node 22 still comes first.
const PNPM_HOME = path.join(os.homedir(), 'Library/pnpm');
const PNPM_FALLBACK = path.join(os.homedir(), '.nvm/versions/node/v20.19.5/bin');
const env = {
  ...process.env,
  PATH: [NODE22_BIN, PNPM_HOME, path.join(PNPM_HOME, 'bin'), PNPM_FALLBACK, process.env.PATH ?? ''].join(':'),
};
const run = (cmd) => {
  try {
    execSync(cmd, { stdio: 'pipe', env });
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
