import { Module } from '@nestjs/common';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PricingRepository } from './repositories/pricing.repository';
import { RulesetEditorRepository } from './repositories/ruleset-editor.repository';
import { RulesetEditorService } from './ruleset-editor.service';

@Module({
  imports: [ServiceabilityModule],
  controllers: [PricingController],
  providers: [PricingRepository, PricingService, RulesetEditorRepository, RulesetEditorService],
  exports: [PricingService, PricingRepository, RulesetEditorService],
})
export class PricingModule {}
