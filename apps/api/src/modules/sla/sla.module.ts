import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { SlaBreachesRepository } from './repositories/sla-breaches.repository';
import { SlaClocksRepository } from './repositories/sla-clocks.repository';
import { SlaService } from './sla.service';
import { SlaSubscribers } from './sla.subscribers';
import { SlaDeskService } from './sla-desk.service';
import { SlaTimerScheduler } from './sla-timers';

/**
 * Owns sla_clocks and sla_breaches (DOMAIN §4, ADR-0016). Reads bookings through BookingsService;
 * speaks to the rest of the system in outbox events. Its job processor lives in src/jobs/.
 */
@Module({
  imports: [BookingsModule],
  providers: [
    SlaClocksRepository,
    SlaBreachesRepository,
    SlaTimerScheduler,
    SlaService,
    SlaDeskService,
    SlaSubscribers,
  ],
  exports: [SlaService, SlaDeskService, SlaBreachesRepository],
})
export class SlaModule {}
