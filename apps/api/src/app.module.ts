import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { DbModule } from './infra/db/db.module';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv(process.env) }],
  exports: [ENV],
})
class ConfigModule {}

@Module({ imports: [ConfigModule, DbModule, HealthModule] })
export class AppModule {}
