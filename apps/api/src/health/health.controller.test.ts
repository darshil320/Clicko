import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

const fakeSql = (impl: () => Promise<unknown>) => impl as never;

const DEGRADED = {
  success: false,
  data: { status: 'degraded', database: 'down' },
  error: 'database unavailable',
};

async function rejection(promise: Promise<unknown>): Promise<ServiceUnavailableException> {
  try {
    await promise;
  } catch (error) {
    return error as ServiceUnavailableException;
  }
  throw new Error('expected the health check to fail');
}

describe('HealthController', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('reports ok when the database answers', async () => {
    const controller = new HealthController(fakeSql(async () => [{ ok: 1 }]));
    expect(await controller.check()).toEqual({
      success: true,
      data: { status: 'ok', database: 'up' },
      error: null,
    });
  });

  it('answers 503 without leaking the driver error', async () => {
    const controller = new HealthController(
      fakeSql(async () => {
        throw new Error('password authentication failed for user clickco');
      }),
    );
    const error = await rejection(controller.check());
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual(DEGRADED);
  });

  it('gives up on a hung database within the probe timeout', async () => {
    const controller = new HealthController(
      fakeSql(() => new Promise(() => {})),
      20,
    );
    const started = Date.now();
    const error = await rejection(controller.check());
    expect(error.getStatus()).toBe(503);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
