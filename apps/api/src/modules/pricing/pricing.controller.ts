import { type QuoteRequest, QuoteRequestBody } from '@clickco/contracts';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ok } from '../../common/envelope';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PricingService } from './pricing.service';

/** Public quote preview. Booking creation (S3) re-quotes server-side and snapshots the result. */
@Controller('pricing')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PricingController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  @Post('quote')
  @HttpCode(200)
  async quote(@Body(new ZodValidationPipe(QuoteRequestBody)) body: QuoteRequest) {
    return ok(await this.pricing.quote(body));
  }
}
