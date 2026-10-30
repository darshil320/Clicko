import type { Provider, Type } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { StepUpService } from './auth/step-up.service';
import { AdminPricingController } from './desks/admin-pricing.controller';
import { PricingDeskService } from './desks/pricing-desk.service';

/**
 * Stream D's part of the AdminModule (ADR-0026 D4/D9): the pricing editor and the step-up
 * authenticator check. One spread each in admin.module.ts.
 */
export const PRICING_IMPORTS: Type[] = [PricingModule];

export const PRICING_CONTROLLERS: Type[] = [AdminPricingController];

export const PRICING_PROVIDERS: Provider[] = [StepUpService, PricingDeskService];
