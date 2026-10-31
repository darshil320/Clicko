import type { Env } from '../../../config/env';

/** The domain every development seed account uses (apps/api/CLAUDE.md). */
export const DEV_STAFF_DOMAIN = '@clickco.test';

/**
 * Clients audit L3: the development staff accounts have a PUBLIC password and authenticator
 * secret. Staging and production refuse to sign in an `@clickco.test` account or any account the
 * dev seed made, even if one was copied into a deployed database. (Development uses them; the test
 * suites sign in with `@clickco.test` addresses.)
 */
export function devAccountRefused(
  nodeEnv: Env['NODE_ENV'],
  email: string,
  createdByDevSeed: boolean,
): boolean {
  if (nodeEnv === 'development' || nodeEnv === 'test') return false;
  return createdByDevSeed || email.trim().toLowerCase().endsWith(DEV_STAFF_DOMAIN);
}
