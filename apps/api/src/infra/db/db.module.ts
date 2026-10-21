import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import postgres from 'postgres';
import { ENV, type Env } from '../../config/env';

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
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  async onApplicationShutdown(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
