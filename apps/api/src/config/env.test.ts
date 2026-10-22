import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgres://clickco:pw@localhost:5432/clickco',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  OTP_HASH_PEPPER: 'b'.repeat(32),
  SMS_ADAPTER: 'console',
};

describe('loadEnv', () => {
  it('parses a complete environment and coerces PORT', () => {
    expect(loadEnv(valid)).toEqual({ ...valid, PORT: 4000, TRUST_PROXY_HOPS: 0 });
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

  it('rejects secrets shorter than 32 characters', () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses the console SMS adapter in production, which would log OTPs', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/SMS_ADAPTER/);
  });

  it('refuses the console SMS adapter in staging too', () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/SMS_ADAPTER/);
  });

  it('refuses the same value for the JWT secret and the OTP pepper', () => {
    expect(() => loadEnv({ ...valid, OTP_HASH_PEPPER: valid.JWT_ACCESS_SECRET })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('never trusts an unbounded proxy chain', () => {
    expect(() => loadEnv({ ...valid, TRUST_PROXY_HOPS: 'true' })).toThrow(/TRUST_PROXY_HOPS/);
  });
});
