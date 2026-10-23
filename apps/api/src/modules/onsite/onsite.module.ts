import { Module } from '@nestjs/common';
import { ProGuard } from '../../common/guards/pro.guard';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PhotographersModule } from '../photographers/photographers.module';
import { PricingModule } from '../pricing/pricing.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { CheckInService } from './check-in.service';
import { CheckOutService } from './check-out.service';
import { ClientExtensionsController } from './client-extensions.controller';
import { EarningsService } from './earnings.service';
import { ExtensionRecords } from './extension-records';
import { ExtensionsService } from './extensions.service';
import { GeofenceGate } from './geofence-gate';
import { IncidentsService } from './incidents.service';
import { NoShowService } from './no-show.service';
import { OnsiteSubscribers } from './onsite.subscribers';
import { OnsiteContextLoader } from './onsite-context';
import { OnsiteTimerScheduler } from './onsite-timers';
import { OnsiteViewsService } from './onsite-views.service';
import { ProEarningsController } from './pro-earnings.controller';
import { ProOnsiteController } from './pro-onsite.controller';
import { AssignmentEventsRepository } from './repositories/assignment-events.repository';
import { WaitingService } from './waiting.service';

/**
 * On-site operations (ADR-0013): en-route → check-in → shoot → check-out, extensions, waiting,
 * incidents, the no-show detector and earnings. Owns `assignment_events`; writes `assignments`
 * through dispatch's AssignmentsService and bookings through BookingsService. Money comes from
 * PricingService. The dev controller is mounted by DevToolsModule.
 */
@Module({
  imports: [
    TokenModule,
    IdempotencyModule,
    BookingsModule,
    DispatchModule,
    PhotographersModule,
    PricingModule,
    ServiceabilityModule,
  ],
  controllers: [ProOnsiteController, ProEarningsController, ClientExtensionsController],
  providers: [
    ProGuard,
    AssignmentEventsRepository,
    OnsiteContextLoader,
    OnsiteTimerScheduler,
    GeofenceGate,
    ExtensionRecords,
    CheckInService,
    CheckOutService,
    ExtensionsService,
    WaitingService,
    IncidentsService,
    NoShowService,
    EarningsService,
    OnsiteViewsService,
    OnsiteSubscribers,
  ],
  exports: [NoShowService, ExtensionsService, OnsiteViewsService, IncidentsService],
})
export class OnsiteModule {}
