import { Module } from '@nestjs/common';
import {
  PgServiceabilityRepository,
  SERVICEABILITY_REPOSITORY,
} from './repositories/serviceability.repository';
import { ServiceabilityController } from './serviceability.controller';
import { ServiceabilityService } from './serviceability.service';
import { WaitlistErasure } from './waitlist-erasure';

@Module({
  controllers: [ServiceabilityController],
  providers: [
    { provide: SERVICEABILITY_REPOSITORY, useClass: PgServiceabilityRepository },
    ServiceabilityService,
    WaitlistErasure,
  ],
  exports: [ServiceabilityService, WaitlistErasure],
})
export class ServiceabilityModule {}
