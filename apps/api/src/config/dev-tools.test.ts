import { describe, expect, it } from 'vitest';
import { devOnlyModules } from '../dev/dev-tools.module';
import { devToolsEnabled } from './dev-tools';

const LOCAL = 'postgres://clickco:x@localhost:5433/clickco';

describe('dev tools gate (security audit L5)', () => {
  it('L5: needs NODE_ENV=development AND DEV_TOOLS=on AND a localhost database', () => {
    expect(devToolsEnabled({ NODE_ENV: 'development', DEV_TOOLS: 'on', DATABASE_URL: LOCAL })).toBe(
      true,
    );
    expect(
      devToolsEnabled({
        NODE_ENV: 'development',
        DEV_TOOLS: 'on',
        DATABASE_URL: 'postgres://clickco:x@127.0.0.1/clickco',
      }),
    ).toBe(true);
  });

  it('L5: NODE_ENV=development alone no longer mounts the dev routes', () => {
    expect(devToolsEnabled({ NODE_ENV: 'development', DATABASE_URL: LOCAL })).toBe(false);
    expect(devOnlyModules({ NODE_ENV: 'development', DATABASE_URL: LOCAL })).toEqual([]);
  });

  it('L5: refused against a database that is not on this machine', () => {
    for (const url of [
      'postgres://u:p@db.internal:5432/clickco',
      'postgres://u:p@10.0.0.5/clickco',
      'not a url',
      undefined,
    ]) {
      expect(devToolsEnabled({ NODE_ENV: 'development', DEV_TOOLS: 'on', DATABASE_URL: url })).toBe(
        false,
      );
    }
  });

  it('L5: refused outside development whatever DEV_TOOLS says', () => {
    for (const NODE_ENV of ['test', 'staging', 'production']) {
      expect(devToolsEnabled({ NODE_ENV, DEV_TOOLS: 'on', DATABASE_URL: LOCAL })).toBe(false);
    }
  });

  it('mounts the dev module when all three hold', () => {
    expect(
      devOnlyModules({ NODE_ENV: 'development', DEV_TOOLS: 'on', DATABASE_URL: LOCAL }),
    ).toHaveLength(1);
  });
});
