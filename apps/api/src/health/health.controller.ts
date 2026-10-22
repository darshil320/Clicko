import {
  Controller,
  Get,
  Inject,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type postgres from 'postgres';
import { SQL } from '../infra/db/db.module';

export interface HealthResponse {
  readonly success: boolean;
  readonly data: { readonly status: 'ok' | 'degraded'; readonly database: 'up' | 'down' };
  readonly error: string | null;
}

export const HEALTH_PROBE_TIMEOUT_MS = 2000;
export const HEALTH_PROBE_TIMEOUT = Symbol('HEALTH_PROBE_TIMEOUT');

@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Optional()
    @Inject(HEALTH_PROBE_TIMEOUT)
    private readonly timeoutMs: number = HEALTH_PROBE_TIMEOUT_MS,
  ) {}

  /** 200 when healthy; 503 when not, so load balancers stop routing to this instance. */
  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.withTimeout(this.sql`SELECT 1 AS ok`);
      return { success: true, data: { status: 'ok', database: 'up' }, error: null };
    } catch (error) {
      // Detail goes to the server log only; the response never carries driver messages.
      this.logger.error(
        'Database health check failed',
        error instanceof Error ? error.stack : error,
      );
      const body: HealthResponse = {
        success: false,
        data: { status: 'degraded', database: 'down' },
        error: 'database unavailable',
      };
      throw new ServiceUnavailableException(body);
    }
  }

  private withTimeout<T>(query: PromiseLike<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`health probe exceeded ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );
    });
    return Promise.race([Promise.resolve(query), timeout]).finally(() => clearTimeout(timer));
  }
}
