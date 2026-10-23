import { Logger } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';

/** The ioredis client for plain commands (dispatch accept locks). BullMQ opens its own. */
export const REDIS = Symbol('REDIS');

/** REDIS_URL → connection options BullMQ and ioredis both accept (password decoded, TLS for rediss). */
export function redisOptions(url: string): RedisOptions {
  const u = new URL(url);
  const db = u.pathname.length > 1 ? Number.parseInt(u.pathname.slice(1), 10) : 0;
  return {
    host: u.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: u.port ? Number.parseInt(u.port, 10) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    db: Number.isNaN(db) ? 0 : db,
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

/** Lazy: nothing connects until the first command, so booting without Redis traffic is free. */
export function createRedisClient(url: string): Redis {
  const logger = new Logger('Redis');
  const client = new Redis({ ...redisOptions(url), lazyConnect: true, maxRetriesPerRequest: 3 });
  // Messages only: an ioredis error never carries the password, but the URL is never logged.
  client.on('error', (error: Error) => logger.warn(`Redis client error: ${error.message}`));
  return client;
}

export async function closeRedisClient(client: Redis): Promise<void> {
  if (client.status === 'wait' || client.status === 'end') {
    client.disconnect();
    return;
  }
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
