import { Module } from '@nestjs/common';
import {
  PgServiceabilityRepository,
  SERVICEABILITY_REPOSITORY,
} from './repositories/serviceability.repository';
import { ServiceabilityController } from './serviceability.controller';
import { ServiceabilityService } from './serviceability.service';

@Module({
  controllers: [ServiceabilityController],
  providers: [
    { provide: SERVICEABILITY_REPOSITORY, useClass: PgServiceabilityRepository },
    ServiceabilityService,
  ],
  exports: [ServiceabilityService],
})
export class ServiceabilityModule {}
