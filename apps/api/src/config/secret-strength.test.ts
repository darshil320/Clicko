import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { publishedSecretProblem, strongSecretProblem } from './secret-strength';

describe('strongSecretProblem (security audit M1)', () => {
  it('accepts 32 random bytes as base64 or hex', () => {
    for (let i = 0; i < 2_000; i += 1) {
      expect(strongSecretProblem(randomBytes(32).toString('base64'))).toBeNull();
      expect(strongSecretProblem(randomBytes(32).toString('base64url'))).toBeNull();
      expect(strongSecretProblem(randomBytes(32).toString('hex'))).toBeNull();
    }
  });

  it('M1: refuses the README development values', () => {
    expect(strongSecretProblem('local-dev-access-secret-at-least-32-chars')).not.toBeNull();
    expect(strongSecretProblem('local-dev-otp-pepper-at-least-32-chars')).not.toBeNull();
    expect(strongSecretProblem('local-dev-otp-pepper-at-least-32-chars-x')).not.toBeNull();
  });

  it.each(['local-dev', 'dev-only', 'example', 'changeme', 'CHANGEME', 'Example'])(
    'M1: refuses anything containing %s',
    (word) => {
      const padded = `${randomBytes(32).toString('base64')}${word}`;
      expect(strongSecretProblem(padded)).toMatch(/placeholder/);
    },
  );

  it('M1: refuses short or low-entropy values that only pass a length check', () => {
    expect(strongSecretProblem('a'.repeat(64))).toMatch(/random/);
    expect(strongSecretProblem('ab'.repeat(32))).toMatch(/random/);
    expect(strongSecretProblem('abcdefgh'.repeat(6))).toMatch(/random/);
    expect(strongSecretProblem(randomBytes(24).toString('base64'))).toMatch(/43/);
  });
});

describe('publishedSecretProblem (security audit M1)', () => {
  it('refuses placeholders but accepts provider-issued secrets of any shape', () => {
    expect(publishedSecretProblem('rzp-key-secret')).toBeNull();
    expect(publishedSecretProblem('w'.repeat(32))).toBeNull();
    expect(publishedSecretProblem('changeme-webhook')).toMatch(/placeholder/);
  });
});
