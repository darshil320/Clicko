import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CLOCK, type Clock } from '../../common/clock';
import { ENV, type Env } from '../../config/env';
import { REDIS } from '../queues/redis';
import { GoogleDriveAdapter } from './adapters/google-drive.adapter';
import { LocalDiskAdapter } from './adapters/local-disk.adapter';
import { STORAGE_PORT, type StoragePort } from './storage.port';
import { RedisUploadBudget, UPLOAD_BUDGET, type UploadBudget } from './upload-budget';

/** The local adapter's root: STORAGE_LOCAL_ROOT, else ./.storage (tests: the OS temp dir). */
export function localStorageRoot(env: Env): string {
  if (env.STORAGE_LOCAL_ROOT) return resolve(env.STORAGE_LOCAL_ROOT);
  return env.NODE_ENV === 'test' ? join(tmpdir(), 'clickco-storage-test') : resolve('.storage');
}

export function createStoragePort(env: Env, budget: UploadBudget, clock: Clock): StoragePort {
  if (env.STORAGE_ADAPTER === 'drive') {
    return new GoogleDriveAdapter(
      {
        sharedDriveId: env.GOOGLE_DRIVE_SHARED_DRIVE_ID ?? null,
        serviceAccountJsonBase64: env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ?? null,
      },
      budget,
      clock,
    );
  }
  return new LocalDiskAdapter(
    {
      root: localStorageRoot(env),
      limitBytes: env.STORAGE_LOCAL_LIMIT_BYTES,
      dailyLimitBytes: env.STORAGE_DAILY_UPLOAD_LIMIT_BYTES ?? null,
    },
    budget,
    clock,
  );
}

/**
 * StoragePort for the API (ADR-0014 D1). STORAGE_ADAPTER picks the adapter once, at boot; every
 * consumer injects STORAGE_PORT and never learns which one it got.
 */
@Module({
  providers: [
    {
      provide: UPLOAD_BUDGET,
      inject: [REDIS, ENV, CLOCK],
      useFactory: (redis: Redis, env: Env, clock: Clock) =>
        new RedisUploadBudget(redis, env.QUEUE_PREFIX, clock),
    },
    {
      provide: STORAGE_PORT,
      inject: [ENV, UPLOAD_BUDGET, CLOCK],
      useFactory: createStoragePort,
    },
  ],
  exports: [STORAGE_PORT, UPLOAD_BUDGET],
})
export class StorageModule {}
