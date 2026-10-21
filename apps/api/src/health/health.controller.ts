import { Controller, Get, Inject, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../infra/db/db.module';

export interface HealthResponse {
  readonly success: boolean;
  readonly data: { readonly status: 'ok' | 'degraded'; readonly database: 'up' | 'down' };
  readonly error: string | null;
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.sql`SELECT 1 AS ok`;
      return { success: true, data: { status: 'ok', database: 'up' }, error: null };
    } catch (error) {
      // Detail goes to the server log only; the response never carries driver messages.
      this.logger.error(
        'Database health check failed',
        error instanceof Error ? error.stack : error,
      );
      return {
        success: false,
        data: { status: 'degraded', database: 'down' },
        error: 'database unavailable',
      };
    }
  }
}
