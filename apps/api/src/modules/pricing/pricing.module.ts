import { Module } from '@nestjs/common';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PricingRepository } from './repositories/pricing.repository';

@Module({
  imports: [ServiceabilityModule],
  controllers: [PricingController],
  providers: [PricingRepository, PricingService],
  exports: [PricingService, PricingRepository],
})
export class PricingModule {}
