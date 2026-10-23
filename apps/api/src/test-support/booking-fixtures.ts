import type { CreateBookingRequest } from '@clickco/contracts';
import type postgres from 'postgres';
import { BookingsService } from '../modules/bookings/bookings.service';
import type { BookingView } from '../modules/bookings/bookings.types';
import { BookingDispatchRepository } from '../modules/bookings/repositories/booking-dispatch.repository';
import { BookingOnsiteRepository } from '../modules/bookings/repositories/booking-onsite.repository';
import { BookingReadsRepository } from '../modules/bookings/repositories/booking-reads.repository';
import { BookingsRepository } from '../modules/bookings/repositories/bookings.repository';
import { computeQuote } from '../modules/pricing/engine';
import type { PromoInput, Quote } from '../modules/pricing/engine/types';
import { PricingRepository } from '../modules/pricing/repositories/pricing.repository';

/** Integration-test helpers for anything that needs a real booking row. */

export const SURAT_PINCODE = '395007';

export async function insertUser(sql: postgres.Sql, phone: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (phone_e164) VALUES (${phone}) RETURNING id`;
  if (!row) throw new Error('insertUser: no row');
  return row.id;
}

export async function suratCityId(sql: postgres.Sql): Promise<string> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM cities WHERE name = 'Surat'`;
  if (!row) throw new Error('suratCityId: seed the launch cities first');
  return row.id;
}

export function bookingRequest(
  overrides: Partial<CreateBookingRequest> = {},
  start = '2026-11-15T06:30:00.000Z',
): CreateBookingRequest {
  return {
    tier: 'PROFESSIONAL',
    categoryCode: 'FOOD',
    pincode: SURAT_PINCODE,
    scheduledStart: start,
    hours: 2,
    addons: [],
    venueAddress: '12 Ghod Dod Road, Surat',
    booker: { name: 'Ananya Iyer', phone: '+919876543210' },
    galleryRecipient: 'BOOKER',
    modelReleaseConsent: false,
    acceptedTermsVersion: '2.0',
    ...overrides,
  };
}

/** Prices a request against the seeded launch ruleset — the same engine call checkout makes. */
export async function quoteFor(
  sql: postgres.Sql,
  req: CreateBookingRequest,
  now: Date,
  promo?: PromoInput,
): Promise<Quote> {
  const ruleset = await new PricingRepository(sql).loadCurrent(now);
  if (!ruleset) throw new Error('quoteFor: seed the launch ruleset first');
  const result = computeQuote(
    {
      tier: req.tier,
      categoryCode: req.categoryCode,
      venue: {
        pincode: req.pincode,
        cityId: await suratCityId(sql),
        cityTier: 'TIER_1',
        travelZone: 0,
        gstStateCode: '24',
      },
      scheduledStart: new Date(req.scheduledStart),
      hours: req.hours,
      now,
      addons: req.addons,
      ...(promo ? { promo } : {}),
    },
    ruleset,
  );
  if (result.kind !== 'QUOTE') throw new Error(`quoteFor: expected a quote, got ${result.kind}`);
  return result;
}

export function bookingsService(sql: postgres.Sql): BookingsService {
  return new BookingsService(
    new BookingsRepository(),
    new BookingReadsRepository(),
    sql,
    new BookingDispatchRepository(),
    new BookingOnsiteRepository(),
  );
}

/** A QUOTED booking for `userId`, created through BookingsService like checkout does. */
export async function createQuotedBooking(
  sql: postgres.Sql,
  userId: string,
  now: Date,
  req: CreateBookingRequest = bookingRequest(),
  promo?: PromoInput,
): Promise<{ view: BookingView; quote: Quote }> {
  const quote = await quoteFor(sql, req, now, promo);
  const cityId = await suratCityId(sql);
  const view = await sql.begin((tx) =>
    bookingsService(sql).createQuoted(tx, { userId, request: req, cityId, quote, now }),
  );
  return { view, quote };
}
