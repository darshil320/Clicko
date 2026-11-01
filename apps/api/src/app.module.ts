import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { CLOCK, systemClock } from './common/clock';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { UserGuardModule } from './common/guards/user-guard.module';
import { IpThrottlerGuard } from './common/http/ip-throttler.guard';
import { ENV, loadEnv } from './config/env';
import { devOnlyModules } from './dev/dev-tools.module';
import { HealthModule } from './health/health.module';
import { DbModule } from './infra/db/db.module';
import { OutboxModule } from './infra/outbox/outbox.module';
import { QueuesModule } from './infra/queues/queues.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CallsModule } from './modules/calls/calls.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { MediaModule } from './modules/media/media.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OnsiteModule } from './modules/onsite/onsite.module';
import { OpsModule } from './modules/ops/ops.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { SafetyModule } from './modules/safety/safety.module';
import { ServiceabilityModule } from './modules/serviceability/serviceability.module';
import { SlaModule } from './modules/sla/sla.module';
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
    UserGuardModule,
    QueuesModule,
    OutboxModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ServiceabilityModule,
    PricingModule,
    CheckoutModule,
    DispatchModule,
    OnsiteModule,
    SlaModule,
    DeliveryModule,
    MediaModule,
    OpsModule,
    CallsModule,
    NotificationsModule,
    SafetyModule,
    AdminModule,
    JobsModule,
    ...devOnlyModules(process.env),
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: IpThrottlerGuard },
  ],
})
export class AppModule {}
