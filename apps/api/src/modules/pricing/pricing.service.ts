import type { QuoteRequest, QuoteResponse } from '@clickco/contracts';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import {
  type BookableVenue,
  ServiceabilityService,
} from '../serviceability/serviceability.service';
import { computeQuote } from './engine';
import type { PromoInput, Quote } from './engine/types';
import { gstStateCode } from './gst-state-codes';
import { toPriceQuote } from './quote-response';
import { PricingRepository } from './repositories/pricing.repository';

const kmToMetres = (km: number): number => Math.round(km * 1000);

/** How often a code has been used — by this user and by everyone (doc 05 step 11). */
export type PromoUsageCounts = Pick<
  PromoInput,
  'userRedemptions' | 'userBookingCount' | 'totalRedemptions'
>;

/** The public preview prices as a first-time user; the booking flow passes real counts. */
const FIRST_TIME_USAGE: PromoUsageCounts = { userRedemptions: 0, userBookingCount: 0 };

export interface BookingQuote {
  readonly quote: Quote;
  readonly venue: BookableVenue;
}

type Priced = { readonly kind: 'QUOTE'; readonly quote: Quote; readonly venue: BookableVenue };
type QuoteOnly = Extract<QuoteResponse, { kind: 'QUOTE_ONLY' }>;

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
   * booking flow re-prices with the signed-in user's real counts (priceForBooking).
   */
  async quote(req: QuoteRequest): Promise<QuoteResponse> {
    const result = await this.price(req, this.clock(), FIRST_TIME_USAGE);
    return result.kind === 'QUOTE_ONLY' ? result : toPriceQuote(result.quote);
  }

  /**
   * POST /bookings: the server-side re-price (doc 05 principle 2) with the user's real promo
   * usage. A quote-only tier (SIGNATURE) cannot be booked instantly.
   */
  async priceForBooking(
    req: QuoteRequest,
    now: Date,
    usage: PromoUsageCounts | null,
  ): Promise<BookingQuote> {
    const result = await this.price(req, now, usage ?? FIRST_TIME_USAGE);
    if (result.kind === 'QUOTE_ONLY') {
      throw new UnprocessableEntityException({
        code: 'SIGNATURE_ENQUIRY_ONLY',
        message: `${result.tier} is booked by enquiry — our team will call you`,
      });
    }
    return { quote: result.quote, venue: result.venue };
  }

  private async price(
    req: QuoteRequest,
    now: Date,
    usage: PromoUsageCounts,
  ): Promise<Priced | QuoteOnly> {
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
        ...(req.promoCode ? { promo: await this.promo(req.promoCode, usage) } : {}),
      },
      ruleset,
    );

    if (result.kind === 'REJECTED') {
      throw new UnprocessableEntityException({ code: result.code, message: result.message });
    }
    if (result.kind === 'QUOTE_ONLY') return result;
    return { kind: 'QUOTE', quote: result, venue };
  }

  private async promo(code: string, usage: PromoUsageCounts): Promise<PromoInput> {
    const promo = await this.repo.findPromo(code);
    if (!promo)
      throw new UnprocessableEntityException({
        code: 'PROMO_INVALID',
        message: 'That code is not valid',
      });
    return { ...promo, ...usage };
  }
}
