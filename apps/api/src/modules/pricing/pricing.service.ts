import type { QuoteRequest, QuoteResponse } from '@clickco/contracts';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import { computeQuote, toBreakdownJson } from './engine';
import type { PromoInput, Quote } from './engine/types';
import { gstStateCode } from './gst-state-codes';
import { PricingRepository } from './repositories/pricing.repository';

const kmToMetres = (km: number): number => Math.round(km * 1000);

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @Inject(PricingRepository) private readonly repo: PricingRepository,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Public quote preview. Promo usage is checked as a first-time user here; the
   * booking flow (S3) re-prices with the signed-in user's real counts before payment.
   */
  async quote(req: QuoteRequest): Promise<QuoteResponse> {
    const now = this.clock();
    const venue = await this.serviceability.resolveVenue(req.pincode);
    const ruleset = await this.repo.loadCurrent(now);
    if (!ruleset) {
      // doc 05 step 1: never fall back to a default. A missing ruleset is a configuration bug.
      this.logger.error(`No published pricing ruleset is effective at ${now.toISOString()}`);
      throw new InternalServerErrorException({
        code: 'NO_RULESET',
        message: 'Pricing is unavailable right now',
      });
    }

    const result = computeQuote(
      {
        tier: req.tier,
        categoryCode: req.categoryCode,
        venue: {
          pincode: venue.pincode,
          cityId: venue.cityId,
          cityTier: venue.cityTier,
          travelZone: venue.travelZone,
          gstStateCode: gstStateCode(venue.state),
        },
        scheduledStart: new Date(req.scheduledStart),
        hours: req.hours,
        now,
        addons: req.addons,
        ...(req.travelDistanceKm === undefined
          ? {}
          : { travelDistanceMetres: kmToMetres(req.travelDistanceKm) }),
        ...(req.promoCode ? { promo: await this.promo(req.promoCode) } : {}),
      },
      ruleset,
    );

    if (result.kind === 'REJECTED') {
      throw new UnprocessableEntityException({ code: result.code, message: result.message });
    }
    if (result.kind === 'QUOTE_ONLY') return result;
    return this.toResponse(result);
  }

  private async promo(code: string): Promise<PromoInput> {
    const promo = await this.repo.findPromo(code);
    if (!promo)
      throw new UnprocessableEntityException({
        code: 'PROMO_INVALID',
        message: 'That code is not valid',
      });
    return { ...promo, userRedemptions: 0, userBookingCount: 0 };
  }

  private toResponse(q: Quote): QuoteResponse {
    const b = toBreakdownJson(q) as Record<string, unknown>;
    return {
      kind: 'QUOTE',
      ...(b as object),
      tier: q.tier,
      cityTier: q.cityTier,
      categoryCode: q.categoryCode,
      hours: q.hours,
      emergencyBand: q.emergencyBand,
      isGuaranteed: q.isGuaranteed,
      captureOnAcceptOnly: q.captureOnAcceptOnly,
      isPeakSeason: q.isPeakSeason,
      travelZone: q.travelZone,
      airspaceCheckRequired: q.airspaceCheckRequired,
      discountPaise: Number(q.discountAmountPaise),
      quoteExpiresAt: q.quoteExpiresAt.toISOString(),
    } as QuoteResponse;
  }
}
