import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STATIC_SECURITY_HEADERS } from './security-headers';

interface VercelJson {
  readonly installCommand?: string;
  readonly buildCommand?: string;
  readonly headers?: ReadonlyArray<{
    readonly source: string;
    readonly headers: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  }>;
}

const vercelJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'),
) as VercelJson;

const sentByVercelJson = (vercelJson.headers ?? []).flatMap((rule) =>
  rule.headers.map((h) => h.key.toLowerCase()),
);

describe('vercel.json (docs/DEPLOY.md)', () => {
  it('sends no second Content-Security-Policy: proxy.ts sets the nonce one per request', () => {
    // A browser enforces every CSP it receives; a static one beside the nonce policy would block
    // the portal's nonce'd scripts and styles.
    expect(sentByVercelJson).not.toContain('content-security-policy');
    expect(sentByVercelJson).not.toContain('content-security-policy-report-only');
  });

  it('repeats none of the hardening headers next.config.ts already sends', () => {
    for (const { key } of STATIC_SECURITY_HEADERS) {
      expect(sentByVercelJson, key).not.toContain(key.toLowerCase());
    }
  });

  it('builds with build:production, so a deploy refuses a missing or non-https API URL', () => {
    expect(vercelJson.buildCommand).toMatch(/pnpm --filter @clickco\/portal run build:production$/);
  });

  it('installs from the frozen lockfile, only the root and this app with its dependencies', () => {
    expect(vercelJson.installCommand).toBe(
      'cd ../.. && pnpm install --frozen-lockfile --filter clickco --filter @clickco/portal...',
    );
  });
});
