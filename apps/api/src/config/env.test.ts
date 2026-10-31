import { describe, expect, it } from 'vitest';
import { DEV_STAFF_TOTP_KEY } from '../modules/admin/auth/secret-box';
import { loadEnv } from './env';

/** A deployed-looking STAFF_TOTP_KEY (32 bytes, base64); not a real secret. */
const TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
/** A deployed-looking BANK_ACCOUNT_KEY (audit M4); not a real secret. */
const BANK_KEY = Buffer.alloc(32, 9).toString('base64');
/** A deployed-looking DELIVERY_LINK_KEY (audit L2); not a real secret. */
const LINK_KEY = 'l'.repeat(40);

const valid = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgres://clickco:pw@localhost:5432/clickco',
  REDIS_URL: 'redis://localhost:6379',
  // Random-looking test-only values: deployed environments refuse weak secrets (audit M1).
  JWT_ACCESS_SECRET: 'DJjKlrrRwyToOxDX2wUzTDn83ZLyfw9zTakdekF9DpM=',
  OTP_HASH_PEPPER: 'r1Cfqxvo58R2rDckz6SogNW/rpEMyEwcYY2WFHvoEVU=',
  SMS_ADAPTER: 'console',
  SANDBOX_WEBHOOK_SECRET: 'local-sandbox-webhook-secret-0123456789',
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
      SANDBOX_WEBHOOK_SECRET: 'local-sandbox-webhook-secret-0123456789',
      STORAGE_ADAPTER: 'local',
      STORAGE_LOCAL_LIMIT_BYTES: 50 * 1024 ** 3,
      JPEG_EXPORT_ADAPTER: 'passthrough',
      DARKTABLE_CLI_PATH: 'darktable-cli',
      MEDIA_WORKER_ISOLATED: false,
      STAFF_TOTP_KEY: DEV_STAFF_TOTP_KEY,
      BANK_ACCOUNT_KEY_VERSION: 2,
      DEV_TOOLS: 'off',
      DB_POOL_MAX: 20,
      DB_IDLE_TIMEOUT_S: 30,
      DB_STATEMENT_TIMEOUT_MS: 5_000,
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: 30_000,
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
      MEDIA_WORKER_ISOLATED: 'true',
      BANK_ACCOUNT_KEY: BANK_KEY,
      DELIVERY_LINK_KEY: LINK_KEY,
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
      MEDIA_WORKER_ISOLATED: 'true',
      BANK_ACCOUNT_KEY: BANK_KEY,
      DELIVERY_LINK_KEY: LINK_KEY,
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
      MEDIA_WORKER_ISOLATED: 'true',
      BANK_ACCOUNT_KEY: BANK_KEY,
      DELIVERY_LINK_KEY: LINK_KEY,
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

  describe('secret strength when deployed (security audit M1)', () => {
    const deployed = {
      ...valid,
      NODE_ENV: 'production',
      SMS_ADAPTER: 'dlt',
      REDIS_URL: 'rediss://cache:6380',
      QUEUE_PREFIX: 'clickco-prod',
      PAYMENT_GATEWAY: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_live_x',
      RAZORPAY_KEY_SECRET: 'rzp-key-secret',
      RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(32),
      STORAGE_ADAPTER: 'drive',
      JPEG_EXPORT_ADAPTER: 'darktable',
      MEDIA_WORKER_ISOLATED: 'true',
      BANK_ACCOUNT_KEY: BANK_KEY,
      DELIVERY_LINK_KEY: LINK_KEY,
      STAFF_TOTP_KEY: TOTP_KEY,
      TRUST_PROXY_HOPS: '1',
    };

    it('accepts random 32-byte secrets', () => {
      expect(loadEnv(deployed).NODE_ENV).toBe('production');
    });

    it.each(['staging', 'production'])(
      'M1: %s refuses the README development secrets',
      (NODE_ENV) => {
        const readme = {
          ...deployed,
          NODE_ENV,
          JWT_ACCESS_SECRET: 'local-dev-access-secret-at-least-32-chars',
          OTP_HASH_PEPPER: 'local-dev-otp-pepper-at-least-32-chars',
        };
        expect(() => loadEnv(readme)).toThrow(
          /JWT_ACCESS_SECRET.*OTP_HASH_PEPPER|OTP_HASH_PEPPER.*JWT_ACCESS_SECRET/,
        );
      },
    );

    it('M1: refuses a 32-character secret that only passes a length check', () => {
      expect(() => loadEnv({ ...deployed, JWT_ACCESS_SECRET: 'a'.repeat(32) })).toThrow(
        /JWT_ACCESS_SECRET/,
      );
      expect(() => loadEnv({ ...deployed, OTP_HASH_PEPPER: 'x'.repeat(64) })).toThrow(
        /OTP_HASH_PEPPER/,
      );
    });

    it('M1: refuses placeholder words in any secret, provider-issued ones included', () => {
      expect(() =>
        loadEnv({ ...deployed, JWT_ACCESS_SECRET: `${valid.JWT_ACCESS_SECRET}changeme` }),
      ).toThrow(/JWT_ACCESS_SECRET/);
      expect(() => loadEnv({ ...deployed, RAZORPAY_KEY_SECRET: 'example-secret' })).toThrow(
        /RAZORPAY_KEY_SECRET/,
      );
      expect(() =>
        loadEnv({ ...deployed, RAZORPAY_WEBHOOK_SECRET: 'dev-only-webhook-secret' }),
      ).toThrow(/RAZORPAY_WEBHOOK_SECRET/);
    });

    it('development keeps accepting simple local values', () => {
      expect(() =>
        loadEnv({ ...valid, JWT_ACCESS_SECRET: 'local-dev-access-secret-at-least-32-chars' }),
      ).not.toThrow();
    });
  });

  describe('DEV_TOOLS (security audit L5)', () => {
    it('defaults to off', () => {
      expect(loadEnv(valid).DEV_TOOLS).toBe('off');
    });

    it('L5: on only in development against a localhost database', () => {
      expect(loadEnv({ ...valid, DEV_TOOLS: 'on' }).DEV_TOOLS).toBe('on');
      expect(() =>
        loadEnv({ ...valid, DEV_TOOLS: 'on', DATABASE_URL: 'postgres://u:p@db.internal/clickco' }),
      ).toThrow(/DEV_TOOLS/);
      expect(() => loadEnv({ ...valid, NODE_ENV: 'test', DEV_TOOLS: 'on' })).toThrow(/DEV_TOOLS/);
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
        MEDIA_WORKER_ISOLATED: 'true',
        BANK_ACCOUNT_KEY: BANK_KEY,
        DELIVERY_LINK_KEY: LINK_KEY,
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
      });
      expect(env.PAYMENT_GATEWAY).toBe('sandbox');
      expect(env.RAZORPAY_KEY_ID).toBeUndefined();
    });

    // Security audit (money and files) L4: no public default for the sandbox's webhook secret.
    it('needs an explicit, non-public sandbox webhook secret in development', () => {
      const { SANDBOX_WEBHOOK_SECRET: _set, ...unset } = valid;
      expect(() => loadEnv(unset)).toThrow(/SANDBOX_WEBHOOK_SECRET/);
      expect(() => loadEnv({ ...valid, SANDBOX_WEBHOOK_SECRET: '' })).toThrow(
        /SANDBOX_WEBHOOK_SECRET/,
      );
      expect(() =>
        loadEnv({ ...valid, SANDBOX_WEBHOOK_SECRET: 'clickco-sandbox-webhook-secret-dev-only' }),
      ).toThrow(/SANDBOX_WEBHOOK_SECRET/);
      expect(() => loadEnv({ ...valid, SANDBOX_WEBHOOK_SECRET: 's'.repeat(31) })).toThrow(
        /SANDBOX_WEBHOOK_SECRET/,
      );
      // Tests may leave it unset (the gateway then signs with a random per-process secret).
      expect(loadEnv({ ...unset, NODE_ENV: 'test' }).SANDBOX_WEBHOOK_SECRET).toBeUndefined();
      // Not needed at all when the sandbox is not the gateway.
      expect(
        loadEnv({
          ...unset,
          PAYMENT_GATEWAY: 'razorpay',
          RAZORPAY_KEY_ID: 'rzp_test_key',
          RAZORPAY_KEY_SECRET: 'rzp-key-secret',
          RAZORPAY_WEBHOOK_SECRET: 'rzp-webhook-secret-123',
        }).SANDBOX_WEBHOOK_SECRET,
      ).toBeUndefined();
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
      BANK_ACCOUNT_KEY: BANK_KEY,
      DELIVERY_LINK_KEY: LINK_KEY,
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
      const env = loadEnv({
        ...prod,
        STORAGE_ADAPTER: 'drive',
        JPEG_EXPORT_ADAPTER: 'darktable',
        MEDIA_WORKER_ISOLATED: 'true',
      });
      expect(env).toMatchObject({ STORAGE_ADAPTER: 'drive', JPEG_EXPORT_ADAPTER: 'darktable' });
    });

    it('audit H1: deployed darktable only runs in the separate, isolated media worker', () => {
      const deployed = { ...prod, STORAGE_ADAPTER: 'drive', JPEG_EXPORT_ADAPTER: 'darktable' };
      for (const NODE_ENV of ['staging', 'production']) {
        expect(() => loadEnv({ ...deployed, NODE_ENV })).toThrow(/MEDIA_WORKER_ISOLATED/);
        expect(() => loadEnv({ ...deployed, NODE_ENV, MEDIA_WORKER_ISOLATED: 'false' })).toThrow(
          /MEDIA_WORKER_ISOLATED/,
        );
        expect(loadEnv({ ...deployed, NODE_ENV, MEDIA_WORKER_ISOLATED: 'true' })).toMatchObject({
          MEDIA_WORKER_ISOLATED: true,
        });
      }
      // Development may still run darktable in-process, and defaults to not isolated.
      expect(loadEnv({ ...valid, JPEG_EXPORT_ADAPTER: 'darktable' }).MEDIA_WORKER_ISOLATED).toBe(
        false,
      );
      expect(() => loadEnv({ ...valid, MEDIA_WORKER_ISOLATED: 'yes' })).toThrow(
        /MEDIA_WORKER_ISOLATED/,
      );
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

  describe('BANK_ACCOUNT_KEY (audit M4)', () => {
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
      MEDIA_WORKER_ISOLATED: 'true',
      TRUST_PROXY_HOPS: '1',
      STAFF_TOTP_KEY: TOTP_KEY,
    };

    it('is required in staging and production', () => {
      expect(() => loadEnv({ ...deployed, DELIVERY_LINK_KEY: LINK_KEY })).toThrow(
        /BANK_ACCOUNT_KEY/,
      );
      expect(
        loadEnv({ ...deployed, BANK_ACCOUNT_KEY: BANK_KEY, DELIVERY_LINK_KEY: LINK_KEY }),
      ).toMatchObject({
        BANK_ACCOUNT_KEY: BANK_KEY,
        DELIVERY_LINK_KEY: LINK_KEY,
        BANK_ACCOUNT_KEY_VERSION: 2,
      });
    });

    it('must differ from STAFF_TOTP_KEY (also the development default) and be 32 bytes', () => {
      expect(() => loadEnv({ ...deployed, BANK_ACCOUNT_KEY: TOTP_KEY })).toThrow(
        /BANK_ACCOUNT_KEY/,
      );
      expect(() => loadEnv({ ...valid, BANK_ACCOUNT_KEY: DEV_STAFF_TOTP_KEY })).toThrow(
        /BANK_ACCOUNT_KEY/,
      );
      const short = Buffer.alloc(16, 1).toString('base64');
      expect(() => loadEnv({ ...valid, BANK_ACCOUNT_KEY: short })).toThrow(/BANK_ACCOUNT_KEY/);
    });

    it('rotates: a previous key under another version opens old numbers', () => {
      const old = Buffer.alloc(32, 3).toString('base64');
      const env = loadEnv({
        ...deployed,
        BANK_ACCOUNT_KEY: BANK_KEY,
        DELIVERY_LINK_KEY: LINK_KEY,
        BANK_ACCOUNT_KEY_VERSION: '3',
        BANK_ACCOUNT_KEY_PREVIOUS: `2:${old}`,
      });
      expect(env.BANK_ACCOUNT_KEY_PREVIOUS).toEqual({ version: 2, key: old });
      expect(() =>
        loadEnv({ ...deployed, BANK_ACCOUNT_KEY: BANK_KEY, BANK_ACCOUNT_KEY_PREVIOUS: `2:${old}` }),
      ).toThrow(/BANK_ACCOUNT_KEY_PREVIOUS/);
      expect(() =>
        loadEnv({ ...deployed, BANK_ACCOUNT_KEY: BANK_KEY, BANK_ACCOUNT_KEY_VERSION: '1' }),
      ).toThrow(/BANK_ACCOUNT_KEY_VERSION/);
    });
  });

  describe('DELIVERY_LINK_KEY (audit L2)', () => {
    it('is required in staging and production and never the JWT secret', () => {
      const prodLike = {
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
        MEDIA_WORKER_ISOLATED: 'true',
        TRUST_PROXY_HOPS: '1',
        STAFF_TOTP_KEY: TOTP_KEY,
        BANK_ACCOUNT_KEY: BANK_KEY,
      };
      expect(() => loadEnv(prodLike)).toThrow(/DELIVERY_LINK_KEY/);
      expect(() => loadEnv({ ...valid, DELIVERY_LINK_KEY: valid.JWT_ACCESS_SECRET })).toThrow(
        /DELIVERY_LINK_KEY/,
      );
      expect(loadEnv({ ...prodLike, DELIVERY_LINK_KEY: LINK_KEY }).DELIVERY_LINK_KEY).toBe(
        LINK_KEY,
      );
    });
  });
});
