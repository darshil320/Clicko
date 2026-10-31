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

@Global()
@Module({
  providers: [
    {
      provide: SQL,
      inject: [ENV],
      useFactory: (env: Env) => postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} }),
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
