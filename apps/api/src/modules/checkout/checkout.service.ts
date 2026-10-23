import type {
  BookingDetail,
  BookingStatus,
  BookingSummary,
  CreateBookingRequest,
  CreateBookingResponse,
} from '@clickco/contracts';
import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import type { BookingView, PromoUsage } from '../bookings/bookings.types';
import { OnsiteViewsService } from '../onsite/onsite-views.service';
import { PaymentsService } from '../payments/payments.service';
import { PricingService } from '../pricing/pricing.service';
import { toPriceQuote } from '../pricing/quote-response';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import { bookingNotFound, conflict } from './http-errors';
import { toBookingDetail, toBookingSummary } from './views';

/**
 * Nothing has been captured in these states, so cancelling needs no refund (refund ladder: S8).
 * An order left open at the gateway may still be paid; that capture is flagged for refund.
 */
const CANCELLABLE_BEFORE_PAYMENT: readonly BookingStatus[] = ['QUOTED', 'ADVANCE_PENDING'];

const sameUsage = (a: PromoUsage, b: PromoUsage): boolean =>
  a.userBookingCount === b.userBookingCount &&
  a.userRedemptions === b.userRedemptions &&
  a.totalRedemptions === b.totalRedemptions;

function assertUniqueAddons(addons: CreateBookingRequest['addons']): void {
  const codes = addons.map((a) => a.code);
  if (new Set(codes).size !== codes.length) {
    throw new UnprocessableEntityException({
      code: 'DUPLICATE_ADDON',
      message: 'List each add-on once and set its quantity instead',
    });
  }
}

/** Orchestrates pricing → bookings for the client booking flow. Owns no tables (ADR-0009). */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OnsiteViewsService) private readonly onsite: OnsiteViewsService,
  ) {}

  /**
   * Re-prices server-side with this user's real promo usage, then — → DRAFT → QUOTED in one tx.
   * A client-sent travel distance is ignored: it would let a caller price a far venue as next
   * door. Travel is priced from the pincode's zone until the server geocodes venues (S5).
   */
  async create(userId: string, req: CreateBookingRequest): Promise<CreateBookingResponse> {
    assertUniqueAddons(req.addons);
    const { travelDistanceKm: _untrusted, ...pricingReq } = req;
    const now = this.clock();
    const code = req.promoCode;
    const usage = code ? await this.bookings.promoUsage(userId, code, now) : null;
    const { quote, venue } = await this.pricing.priceForBooking(pricingReq, now, usage);
    return this.sql.begin(async (tx) => {
      if (code && usage && quote.promoCode) {
        const locked = await this.bookings.promoUsageLocked(tx, userId, code, now);
        if (!sameUsage(locked, usage)) {
          throw conflict('PROMO_USAGE_CHANGED', 'That code was just used — please try again');
        }
      }
      const view = await this.bookings.createQuoted(tx, {
        userId,
        request: pricingReq,
        cityId: venue.cityId,
        quote,
        now,
      });
      // Built inside the tx: a mapping failure rolls the booking back, so a retry is safe.
      return { booking: toBookingSummary(view, venue.cityName), quote: toPriceQuote(quote) };
    });
  }

  async list(userId: string): Promise<BookingSummary[]> {
    const views = await this.bookings.listForUser(userId);
    const names = await this.serviceability.cityNames(views.map((v) => v.cityId));
    return views.map((v) => toBookingSummary(v, names.get(v.cityId) ?? ''));
  }

  async detail(userId: string, bookingId: string): Promise<BookingDetail> {
    const view = await this.bookings.findForUser(userId, bookingId);
    if (!view) throw bookingNotFound();
    const [timeline, invoices, cityName, extras] = await Promise.all([
      this.bookings.timeline(bookingId),
      this.payments.invoicesForBooking(bookingId),
      this.cityName(view),
      this.onsite.clientExtras(bookingId),
    ]);
    return toBookingDetail(view, cityName, timeline, invoices, extras);
  }

  /** QUOTED / ADVANCE_PENDING → CANCELLED_CLIENT. Later states need the refund ladder (S8). */
  async cancel(userId: string, bookingId: string): Promise<BookingSummary> {
    const now = this.clock();
    return this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, bookingId);
      if (booking.userId !== userId) throw bookingNotFound();
      if (!CANCELLABLE_BEFORE_PAYMENT.includes(booking.status)) {
        throw conflict(
          'CANCEL_NOT_AVAILABLE',
          `A ${booking.status} booking cannot be cancelled here yet — contact support`,
        );
      }
      await this.bookings.transition(tx, {
        bookingId,
        to: 'CANCELLED_CLIENT',
        actor: { kind: 'USER', id: userId },
        occurredAt: now,
        reason: 'Cancelled by the client before payment',
        cancellationReason: 'CLIENT_CANCELLED_BEFORE_PAYMENT',
      });
      const view = await this.bookings.view(tx, bookingId);
      return toBookingSummary(view, await this.cityName(view));
    });
  }

  private async cityName(view: BookingView): Promise<string> {
    return (await this.serviceability.cityNames([view.cityId])).get(view.cityId) ?? '';
  }
}
