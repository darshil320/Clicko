import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

const fakeSql = (impl: () => Promise<unknown>) => impl as never;

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

  it('reports degraded without leaking the driver error', async () => {
    const controller = new HealthController(
      fakeSql(async () => {
        throw new Error('password authentication failed for user clickco');
      }),
    );
    const result = await controller.check();
    expect(result).toEqual({
      success: false,
      data: { status: 'degraded', database: 'down' },
      error: 'database unavailable',
    });
  });
});
