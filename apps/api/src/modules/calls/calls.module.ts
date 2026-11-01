import { Module } from '@nestjs/common';
import { ProGuard } from '../../common/guards/pro.guard';
import { type FetchLike, globalFetch, HTTP_FETCH } from '../../common/http/fetch-like';
import { ENV, type Env } from '../../config/env';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PhotographersModule } from '../photographers/photographers.module';
import { UsersModule } from '../users/users.module';
import { ConsoleCallsAdapter } from './adapters/console-calls.adapter';
import { ExotelCallsAdapter } from './adapters/exotel-calls.adapter';
import {
  ClientCallsController,
  ExotelWebhookController,
  ProCallsController,
} from './call.controllers';
import { CALLS_PORT } from './calls.port';
import { CallsService } from './calls.service';
import { CallsSubscribers } from './calls.subscribers';
import { CallBindingsRepository } from './repositories/call-bindings.repository';
import { CallLogsRepository } from './repositories/call-logs.repository';

/** env.ts guarantees every Exotel setting when CALLS_ADAPTER=exotel; this re-checks. */
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required by CALLS_ADAPTER=exotel`);
  return value;
}

export function callsAdapter(env: Env, fetch: FetchLike) {
  if (env.CALLS_ADAPTER === 'console') return new ConsoleCallsAdapter();
  return new ExotelCallsAdapter(
    {
      accountSid: required(env.EXOTEL_ACCOUNT_SID, 'EXOTEL_ACCOUNT_SID'),
      apiKey: required(env.EXOTEL_API_KEY, 'EXOTEL_API_KEY'),
      apiToken: required(env.EXOTEL_API_TOKEN, 'EXOTEL_API_TOKEN'),
      host: env.EXOTEL_API_HOST,
      callerId: required(env.EXOTEL_CALLER_ID, 'EXOTEL_CALLER_ID'),
    },
    fetch,
  );
}

/**
 * Masked calls (ADR-0027 D3). Owns call_bindings and call_logs. Reads the booking (bookings),
 * the current assignment (dispatch), the client's phone (users) and the photographer's
 * (photographers) through their services, and hands the numbers only to the provider.
 */
@Module({
  imports: [TokenModule, BookingsModule, DispatchModule, UsersModule, PhotographersModule],
  controllers: [ClientCallsController, ProCallsController, ExotelWebhookController],
  providers: [
    ProGuard,
    { provide: HTTP_FETCH, useValue: globalFetch },
    { provide: CALLS_PORT, inject: [ENV, HTTP_FETCH], useFactory: callsAdapter },
    CallBindingsRepository,
    CallLogsRepository,
    CallsService,
    CallsSubscribers,
  ],
  exports: [CallsService],
})
export class CallsModule {}
