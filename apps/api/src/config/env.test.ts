import { describe, expect, it } from 'vitest';
import { DEV_STAFF_TOTP_KEY } from '../modules/admin/auth/secret-box';
import { loadEnv } from './env';

/** A deployed-looking STAFF_TOTP_KEY (32 bytes, base64); not a real secret. */
const TOTP_KEY = Buffer.alloc(32, 7).toString('base64');

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
    expect(loadEnv(valid)).toEqual({
      ...valid,
      PORT: 4000,
      QUEUE_PREFIX: 'clickco',
      QUEUE_WORKERS: 'on',
      TRUST_PROXY_HOPS: 0,
      CORS_ORIGINS: [],
      PAYMENT_GATEWAY: 'sandbox',
      SANDBOX_WEBHOOK_SECRET: 'clickco-sandbox-webhook-secret-dev-only',
      STORAGE_ADAPTER: 'local',
      STORAGE_LOCAL_LIMIT_BYTES: 50 * 1024 ** 3,
      JPEG_EXPORT_ADAPTER: 'passthrough',
      DARKTABLE_CLI_PATH: 'darktable-cli',
      STAFF_TOTP_KEY: DEV_STAFF_TOTP_KEY,
    });
  });

  it('accepts a queue namespace; workers can be switched off in test only', () => {
    const env = loadEnv({
      ...valid,
      NODE_ENV: 'test',
      QUEUE_PREFIX: 'clickco-test-1a2b',
      QUEUE_WORKERS: 'off',
    });
    expect(env).toMatchObject({ QUEUE_PREFIX: 'clickco-test-1a2b', QUEUE_WORKERS: 'off' });
    expect(() => loadEnv({ ...valid, QUEUE_PREFIX: 'bad:prefix' })).toThrow(/QUEUE_PREFIX/);
    expect(() => loadEnv({ ...valid, QUEUE_WORKERS: 'off' })).toThrow(/QUEUE_WORKERS/);
  });

  it('staging and production need TLS Redis and an explicit queue prefix', () => {
    const deployed = {
      ...valid,
      NODE_ENV: 'production',
      SMS_ADAPTER: 'dlt',
      PAYMENT_GATEWAY: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_live_x',
      RAZORPAY_KEY_SECRET: 'secret',
      RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(32),
      STORAGE_ADAPTER: 'drive',
      JPEG_EXPORT_ADAPTER: 'darktable',
      TRUST_PROXY_HOPS: '1',
      STAFF_TOTP_KEY: TOTP_KEY,
    };
    expect(() => loadEnv({ ...deployed, QUEUE_PREFIX: 'clickco-prod' })).toThrow(/REDIS_URL/);
    expect(() => loadEnv({ ...deployed, REDIS_URL: 'rediss://cache:6380' })).toThrow(
      /QUEUE_PREFIX/,
    );
    expect(
      loadEnv({ ...deployed, REDIS_URL: 'rediss://cache:6380', QUEUE_PREFIX: 'clickco-prod' }),
    ).toMatchObject({ QUEUE_PREFIX: 'clickco-prod' });
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

  describe('STAFF_TOTP_KEY (ADR-0025 D2)', () => {
    const deployed = {
      ...valid,
      NODE_ENV: 'production',
      SMS_ADAPTER: 'dlt',
      REDIS_URL: 'rediss://cache:6380',
      QUEUE_PREFIX: 'clickco-prod',
      PAYMENT_GATEWAY: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_live_x',
      RAZORPAY_KEY_SECRET: 'secret',
      RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(32),
      STORAGE_ADAPTER: 'drive',
      JPEG_EXPORT_ADAPTER: 'darktable',
      TRUST_PROXY_HOPS: '1',
    };

    it('defaults to the public development key in development and test', () => {
      expect(loadEnv(valid).STAFF_TOTP_KEY).toBe(DEV_STAFF_TOTP_KEY);
      expect(loadEnv({ ...valid, NODE_ENV: 'test', STAFF_TOTP_KEY: '' }).STAFF_TOTP_KEY).toBe(
        DEV_STAFF_TOTP_KEY,
      );
    });

    it('is required in staging and production, and never the development key', () => {
      expect(() => loadEnv(deployed)).toThrow(/STAFF_TOTP_KEY/);
      expect(() => loadEnv({ ...deployed, STAFF_TOTP_KEY: DEV_STAFF_TOTP_KEY })).toThrow(
        /STAFF_TOTP_KEY/,
      );
      const unpadded = DEV_STAFF_TOTP_KEY.replace(/=+$/, '');
      expect(() => loadEnv({ ...deployed, STAFF_TOTP_KEY: unpadded })).toThrow(/STAFF_TOTP_KEY/);
      expect(loadEnv({ ...deployed, STAFF_TOTP_KEY: TOTP_KEY }).STAFF_TOTP_KEY).toBe(TOTP_KEY);
    });

    it('must decode to exactly 32 bytes', () => {
      const short = Buffer.alloc(16, 1).toString('base64');
      expect(() => loadEnv({ ...valid, STAFF_TOTP_KEY: short })).toThrow(/STAFF_TOTP_KEY/);
      expect(() => loadEnv({ ...valid, STAFF_TOTP_KEY: 'not base64 at all!' })).toThrow(
        /STAFF_TOTP_KEY/,
      );
    });
  });

  describe('when deployed (security review L6)', () => {
    const deployed = {
      ...valid,
      NODE_ENV: 'staging',
      SMS_ADAPTER: 'dlt',
      REDIS_URL: 'rediss://cache:6380',
      QUEUE_PREFIX: 'clickco-staging',
      PAYMENT_GATEWAY: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_key',
      RAZORPAY_KEY_SECRET: 'rzp-key-secret',
      RAZORPAY_WEBHOOK_SECRET: 'rzp-webhook-secret-123',
      STORAGE_ADAPTER: 'drive',
      JPEG_EXPORT_ADAPTER: 'darktable',
      STAFF_TOTP_KEY: TOTP_KEY,
    };

    it('the proxy hop count must be explicit (0 behind a load balancer pools every client)', () => {
      expect(() => loadEnv(deployed)).toThrow(/TRUST_PROXY_HOPS/);
      expect(loadEnv({ ...deployed, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
      expect(loadEnv({ ...deployed, TRUST_PROXY_HOPS: '0' }).TRUST_PROXY_HOPS).toBe(0);
    });

    it('browser origins must be https', () => {
      const env = { ...deployed, TRUST_PROXY_HOPS: '1' };
      expect(() => loadEnv({ ...env, CORS_ORIGINS: 'http://admin.clickco.in' })).toThrow(
        /CORS_ORIGINS/,
      );
      expect(loadEnv({ ...env, CORS_ORIGINS: 'https://admin.clickco.in' }).CORS_ORIGINS).toEqual([
        'https://admin.clickco.in',
      ]);
    });
  });

  it('parses an explicit list of CORS origins and rejects junk', () => {
    expect(
      loadEnv({ ...valid, CORS_ORIGINS: 'http://localhost:3001, https://admin.clickco.in' })
        .CORS_ORIGINS,
    ).toEqual(['http://localhost:3001', 'https://admin.clickco.in']);
    expect(() => loadEnv({ ...valid, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });

  describe('payment gateway', () => {
    const live = { ...valid, SMS_ADAPTER: 'dlt' };
    const razorpay = {
      PAYMENT_GATEWAY: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_key',
      RAZORPAY_KEY_SECRET: 'rzp-key-secret',
      RAZORPAY_WEBHOOK_SECRET: 'rzp-webhook-secret-123',
    };

    it('defaults to the sandbox in development', () => {
      expect(loadEnv(valid).PAYMENT_GATEWAY).toBe('sandbox');
    });

    it('refuses the sandbox gateway in staging and production', () => {
      expect(() => loadEnv({ ...live, NODE_ENV: 'staging' })).toThrow(/PAYMENT_GATEWAY/);
      expect(() => loadEnv({ ...live, NODE_ENV: 'production' })).toThrow(/PAYMENT_GATEWAY/);
    });

    it('accepts razorpay in production with all three keys', () => {
      const env = loadEnv({
        ...live,
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://cache.internal:6380',
        QUEUE_PREFIX: 'clickco-prod',
        STORAGE_ADAPTER: 'drive',
        JPEG_EXPORT_ADAPTER: 'darktable',
        TRUST_PROXY_HOPS: '1',
        STAFF_TOTP_KEY: TOTP_KEY,
        ...razorpay,
      });
      expect(env.PAYMENT_GATEWAY).toBe('razorpay');
    });

    it('refuses razorpay when any key is missing', () => {
      for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
        const partial: Record<string, string> = { ...live, NODE_ENV: 'production', ...razorpay };
        delete partial[key];
        expect(() => loadEnv(partial)).toThrow(/RAZORPAY_KEY_ID/);
      }
    });

    it('treats keys left empty from .env.example as unset', () => {
      const env = loadEnv({
        ...valid,
        PAYMENT_GATEWAY: '',
        RAZORPAY_KEY_ID: '',
        RAZORPAY_KEY_SECRET: '',
        RAZORPAY_WEBHOOK_SECRET: '',
        SANDBOX_WEBHOOK_SECRET: '',
      });
      expect(env.PAYMENT_GATEWAY).toBe('sandbox');
      expect(env.RAZORPAY_KEY_ID).toBeUndefined();
      expect(env.SANDBOX_WEBHOOK_SECRET).toBe('clickco-sandbox-webhook-secret-dev-only');
    });

    it('rejects an unknown gateway', () => {
      expect(() => loadEnv({ ...valid, PAYMENT_GATEWAY: 'paypal' })).toThrow(/PAYMENT_GATEWAY/);
    });
  });

  describe('media storage and JPEG export (ADR-0014)', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      SMS_ADAPTER: 'dlt',
      REDIS_URL: 'rediss://cache:6380',
      QUEUE_PREFIX: 'clickco-prod',
      PAYMENT_GATEWAY: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_key',
      RAZORPAY_KEY_SECRET: 'rzp-key-secret',
      RAZORPAY_WEBHOOK_SECRET: 'rzp-webhook-secret-123',
      TRUST_PROXY_HOPS: '1',
      STAFF_TOTP_KEY: TOTP_KEY,
    };

    it('defaults to local disk and the passthrough exporter in development', () => {
      const env = loadEnv(valid);
      expect(env.STORAGE_ADAPTER).toBe('local');
      expect(env.STORAGE_LOCAL_ROOT).toBeUndefined();
      expect(env.JPEG_EXPORT_ADAPTER).toBe('passthrough');
      expect(env.STORAGE_DAILY_UPLOAD_LIMIT_BYTES).toBeUndefined();
    });

    it('refuses local storage and the passthrough exporter in staging and production', () => {
      for (const NODE_ENV of ['staging', 'production']) {
        expect(() => loadEnv({ ...prod, NODE_ENV, JPEG_EXPORT_ADAPTER: 'darktable' })).toThrow(
          /STORAGE_ADAPTER/,
        );
        expect(() => loadEnv({ ...prod, NODE_ENV, STORAGE_ADAPTER: 'drive' })).toThrow(
          /JPEG_EXPORT_ADAPTER/,
        );
      }
      const env = loadEnv({ ...prod, STORAGE_ADAPTER: 'drive', JPEG_EXPORT_ADAPTER: 'darktable' });
      expect(env).toMatchObject({ STORAGE_ADAPTER: 'drive', JPEG_EXPORT_ADAPTER: 'darktable' });
    });

    it('coerces byte limits and rejects junk adapters', () => {
      const env = loadEnv({
        ...valid,
        STORAGE_LOCAL_ROOT: '/tmp/clickco',
        STORAGE_LOCAL_LIMIT_BYTES: '1000',
        STORAGE_DAILY_UPLOAD_LIMIT_BYTES: '500',
      });
      expect(env).toMatchObject({
        STORAGE_LOCAL_ROOT: '/tmp/clickco',
        STORAGE_LOCAL_LIMIT_BYTES: 1000,
        STORAGE_DAILY_UPLOAD_LIMIT_BYTES: 500,
      });
      expect(() => loadEnv({ ...valid, STORAGE_ADAPTER: 's3' })).toThrow(/STORAGE_ADAPTER/);
      expect(() => loadEnv({ ...valid, JPEG_EXPORT_ADAPTER: 'lightroom' })).toThrow(
        /JPEG_EXPORT_ADAPTER/,
      );
      expect(() => loadEnv({ ...valid, STORAGE_LOCAL_LIMIT_BYTES: '-1' })).toThrow(
        /STORAGE_LOCAL_LIMIT_BYTES/,
      );
    });
  });
});
