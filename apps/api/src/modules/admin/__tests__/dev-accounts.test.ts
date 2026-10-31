import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { seedDevStaff } from '../../../infra/db/seeds/dev-staff';
import { devAccountRefused } from '../auth/dev-accounts';
import { DEV_STAFF_TOTP_KEY } from '../auth/secret-box';

describe('development staff accounts (clients audit L3)', () => {
  it.each(['staging', 'production'] as const)(
    'L3: %s refuses an @clickco.test account and any account the dev seed made',
    (nodeEnv) => {
      expect(devAccountRefused(nodeEnv, 'super-admin@clickco.test', false)).toBe(true);
      expect(devAccountRefused(nodeEnv, 'SUPPORT@CLICKCO.TEST', false)).toBe(true);
      expect(devAccountRefused(nodeEnv, 'renamed@clickco.in', true)).toBe(true);
      expect(devAccountRefused(nodeEnv, 'priya@clickco.in', false)).toBe(false);
    },
  );

  it('development and test keep them (the panel and the e2e suites sign in with them)', () => {
    for (const nodeEnv of ['development', 'test'] as const) {
      expect(devAccountRefused(nodeEnv, 'super-admin@clickco.test', true)).toBe(false);
    }
  });

  it('L3: the dev seed refuses unless STAFF_TOTP_KEY is the built-in public dev key', async () => {
    const realKey = randomBytes(32).toString('base64');
    // Refused before any query: the sql stub would throw if it were reached.
    const sql = (() => {
      throw new Error('must not query');
    }) as never;
    await expect(seedDevStaff(sql, realKey, new Date())).rejects.toThrow(/STAFF_TOTP_KEY/);
    await expect(seedDevStaff(sql, DEV_STAFF_TOTP_KEY, new Date())).rejects.toThrow(
      /must not query/,
    );
  });
});
