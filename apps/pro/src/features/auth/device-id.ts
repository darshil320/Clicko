import { newIdempotencyKey } from '@clickco/api-client';
import { kv } from '@/shared/storage/kv';

const KEY = 'clickco.pro.device-id';

/** A random id per install, sent at sign-in so ops can tell a photographer's phones apart. */
export function deviceId(): string {
  const existing = kv.getString(KEY);
  if (existing) return existing;
  const created = `pro-${newIdempotencyKey()}`;
  kv.set(KEY, created);
  return created;
}
