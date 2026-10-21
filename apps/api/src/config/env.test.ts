import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgres://clickco:pw@localhost:5432/clickco',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv', () => {
  it('parses a complete environment and coerces PORT', () => {
    expect(loadEnv(valid)).toEqual({ ...valid, PORT: 4000 });
  });

  it('fails at boot when a required variable is missing', () => {
    const { DATABASE_URL: _omit, ...missing } = valid;
    expect(() => loadEnv(missing)).toThrow(/DATABASE_URL/);
  });

  it('rejects a database URL that is not postgres', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://x@y/z' })).toThrow(/DATABASE_URL/);
  });

  it('never echoes variable values in the error message', () => {
    expect(() => loadEnv({ ...valid, REDIS_URL: 'not-a-url-SECRET123' })).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining('SECRET123') }),
    );
  });
});
