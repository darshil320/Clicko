import { describe, expect, it } from 'vitest';
import { loadWorkerEnv, WORKER_FORBIDDEN_SECRETS } from './env';

/** What the media worker's container is given (audit H1): no app secrets at all. */
const workerProd = {
  NODE_ENV: 'production',
  PORT: '0',
  DATABASE_URL: 'postgres://media_worker:pw@db:5432/clickco',
  REDIS_URL: 'rediss://media-worker:pw@cache:6380',
  QUEUE_PREFIX: 'clickco-prod',
  TRUST_PROXY_HOPS: '0',
  STORAGE_ADAPTER: 'drive',
  JPEG_EXPORT_ADAPTER: 'darktable',
  MEDIA_WORKER_ISOLATED: 'true',
};

describe('loadWorkerEnv (audit H1: the media worker holds no app secrets)', () => {
  it('boots without any API secret, filling them with throwaway random values', () => {
    const a = loadWorkerEnv(workerProd);
    const b = loadWorkerEnv(workerProd);
    expect(a.MEDIA_WORKER_ISOLATED).toBe(true);
    expect(a.JWT_ACCESS_SECRET).not.toBe(b.JWT_ACCESS_SECRET);
    expect(a.BANK_ACCOUNT_KEY).not.toBe(b.BANK_ACCOUNT_KEY);
  });

  it('refuses to boot when deployed with any app secret in its environment', () => {
    for (const name of WORKER_FORBIDDEN_SECRETS) {
      expect(() => loadWorkerEnv({ ...workerProd, [name]: 'x'.repeat(44) }), name).toThrow(
        new RegExp(name),
      );
    }
  });

  it('runs only isolated', () => {
    expect(() => loadWorkerEnv({ ...workerProd, MEDIA_WORKER_ISOLATED: 'false' })).toThrow(
      /MEDIA_WORKER_ISOLATED/,
    );
  });
});
