import { Logger, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CLOCK, type Clock } from '../../common/clock';
import { ENV, type Env } from '../../config/env';
import { REDIS } from '../../infra/queues/redis';
import { PhotographersModule } from '../photographers/photographers.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { OtpService } from './otp.service';
import { OtpDelivery } from './otp-delivery';
import { OTP_LIMITS, RedisOtpLimits } from './otp-limits';
import { OTP_PEPPER } from './otp-tokens';
import { ProAuthController } from './pro-auth.controller';
import { OTP_REPOSITORY, PgOtpRepository } from './repositories/otp.repository';
import { ConsoleSmsAdapter } from './sms/console-sms.adapter';
import { SMS_PORT } from './sms/sms.port';
import { TokenModule } from './token.module';

@Module({
  imports: [TokenModule, UsersModule, PhotographersModule],
  controllers: [AuthController, ProAuthController],
  providers: [
    { provide: OTP_PEPPER, inject: [ENV], useFactory: (env: Env) => env.OTP_HASH_PEPPER },
    { provide: OTP_REPOSITORY, useClass: PgOtpRepository },
    {
      // Audit M5/L2: global + per-prefix SMS budgets with a circuit breaker; per-phone verify lock.
      provide: OTP_LIMITS,
      inject: [REDIS, ENV, CLOCK],
      useFactory: (redis: Redis, env: Env, clock: Clock) => {
        const logger = new Logger('OtpLimits');
        return new RedisOtpLimits(redis, env.QUEUE_PREFIX, clock, undefined, (message) =>
          // The ops alert: an ERROR line tagged for the log-based alert rule.
          logger.error(`[OPS-ALERT otp-sms-budget] ${message}`),
        );
      },
    },
    {
      provide: SMS_PORT,
      inject: [ENV],
      useFactory: (env: Env) => {
        if (env.SMS_ADAPTER === 'console') return new ConsoleSmsAdapter();
        throw new Error(
          'SMS_ADAPTER=dlt is not implemented yet (waiting on TRAI DLT approval, PLAN B6)',
        );
      },
    },
    OtpDelivery,
    OtpService,
  ],
  exports: [OtpDelivery, SMS_PORT],
})
export class AuthModule {}
