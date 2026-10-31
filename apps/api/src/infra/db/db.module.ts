import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import postgres from 'postgres';
import { ENV, type Env } from '../../config/env';
import { checkRuntimeRole, readRuntimeRole } from './runtime-role-check';

export const SQL = Symbol('SQL');

/**
 * Performance audit (ADR-0027 D6): pool size and idle close from env, and server-side limits on
 * every connection — a runaway statement and a transaction left open by a hung request are ended
 * by Postgres instead of holding a pool slot (and row locks) indefinitely.
 */
export function poolOptions(env: Env) {
  return {
    max: env.DB_POOL_MAX,
    idle_timeout: env.DB_IDLE_TIMEOUT_S,
    onnotice: () => {},
    connection: {
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    },
  } as const;
}

@Global()
@Module({
  providers: [
    {
      provide: SQL,
      inject: [ENV],
      useFactory: (env: Env) => postgres(env.DATABASE_URL, poolOptions(env)),
    },
  ],
  exports: [SQL],
})
export class DbModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Security audit M4: staging/production refuse to boot as the table owner or a superuser. */
  async onModuleInit(): Promise<void> {
    await checkRuntimeRole(() => readRuntimeRole(this.sql), this.env.NODE_ENV);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
