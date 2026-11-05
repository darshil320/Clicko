import { Logger, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CLOCK, type Clock } from '../../common/clock';
import { globalFetch, HTTP_FETCH } from '../../common/http/fetch-like';
import { ENV, type Env } from '../../config/env';
import { REDIS } from '../../infra/queues/redis';
import { PhotographersModule } from '../photographers/photographers.module';
import { UsersModule } from '../users/users.module';
import { AuthAccountErasure } from './account-erasure';
import { AuthController } from './auth.controller';
import { OtpService } from './otp.service';
import { OtpDelivery } from './otp-delivery';
import { OTP_LIMITS, RedisOtpLimits } from './otp-limits';
import { OTP_PEPPER } from './otp-tokens';
import { ProAuthController } from './pro-auth.controller';
import { OTP_REPOSITORY, PgOtpRepository } from './repositories/otp.repository';
import { SMS_PORT } from './sms/sms.port';
import { otpSmsAdapter } from './sms/sms-providers';
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
    // SMS_ADAPTER: console (development and test) or MSG91 on the DLT OTP template (ADR-0029 D1).
    { provide: HTTP_FETCH, useValue: globalFetch },
    { provide: SMS_PORT, inject: [ENV, HTTP_FETCH], useFactory: otpSmsAdapter },
    OtpDelivery,
    OtpService,
    AuthAccountErasure,
  ],
  // OtpService: the account-deletion module re-confirms the client with a fresh code (ADR-0030).
  exports: [OtpDelivery, SMS_PORT, OtpService, AuthAccountErasure],
})
export class AuthModule {}
