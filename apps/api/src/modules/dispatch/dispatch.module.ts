import { Module } from '@nestjs/common';
import { ProGuard } from '../../common/guards/pro.guard';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';
import { PhotographersModule } from '../photographers/photographers.module';
import { PricingModule } from '../pricing/pricing.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { AcceptanceCaptureService } from './acceptance-capture.service';
import { DispatchSubscribers } from './dispatch.subscribers';
import { DispatchDeskService } from './dispatch-desk.service';
import { DispatchEngine } from './dispatch-engine.service';
import { DispatchLock } from './dispatch-lock';
import { DispatchStartService } from './dispatch-start.service';
import { DispatchTimersService } from './dispatch-timers.service';
import { OffersService } from './offers.service';
import { ProAssignmentsController } from './pro-assignments.controller';
import { ProOffersController } from './pro-offers.controller';
import { RedispatchService } from './redispatch.service';
import { AssignmentsRepository } from './repositories/assignments.repository';
import { AttemptsRepository } from './repositories/attempts.repository';
import { EligibilityRepository } from './repositories/eligibility.repository';
import { RoundsRepository } from './repositories/rounds.repository';
import { DispatchRunState } from './run-state.service';
import { DispatchTimerScheduler } from './timer-scheduler';

/**
 * Owns dispatch_rounds, dispatch_attempts and assignments (ADR-0010/0012). Orchestrates bookings
 * (status), payments (capture/release), photographers (pool, penalties), pricing (deadline,
 * incentive) and serviceability (venue fallback); the PostGIS query lives in
 * repositories/eligibility.repository.ts. The dev desk controller is in DevToolsModule.
 */
@Module({
  imports: [
    TokenModule,
    IdempotencyModule,
    BookingsModule,
    PaymentsModule,
    PhotographersModule,
    PricingModule,
    ServiceabilityModule,
  ],
  controllers: [ProOffersController, ProAssignmentsController],
  providers: [
    ProGuard,
    DispatchRunState,
    RoundsRepository,
    AttemptsRepository,
    AssignmentsRepository,
    EligibilityRepository,
    DispatchLock,
    DispatchTimerScheduler,
    DispatchEngine,
    DispatchStartService,
    DispatchTimersService,
    OffersService,
    RedispatchService,
    AcceptanceCaptureService,
    DispatchDeskService,
    DispatchSubscribers,
  ],
  exports: [DispatchTimersService, RedispatchService, DispatchDeskService],
})
export class DispatchModule {}
