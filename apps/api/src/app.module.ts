import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CLOCK, systemClock } from './common/clock';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ENV, loadEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { DbModule } from './infra/db/db.module';
import { AuthModule } from './modules/auth/auth.module';
import { ServiceabilityModule } from './modules/serviceability/serviceability.module';
import { UsersModule } from './modules/users/users.module';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv(process.env) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [ENV, CLOCK],
})
class CoreModule {}

@Module({
  imports: [
    CoreModule,
    // Per-IP backstop for every route (in-memory: fine for one instance; move to Redis storage
    // before scaling out). OTP and waitlist have their own per-phone limits on top.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    DbModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ServiceabilityModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
