import type {
  CityTier,
  JoinWaitlistBody,
  JoinWaitlistResponse,
  ServiceabilityResult,
} from '@clickco/contracts';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import {
  SERVICEABILITY_REPOSITORY,
  type ServiceabilityRepository,
} from './repositories/serviceability.repository';
import type { AreaLabel, VenueFallback } from './serviceability.types';

export interface BookableVenue {
  readonly pincode: string;
  readonly cityId: string;
  readonly cityName: string;
  readonly cityTier: CityTier;
  readonly state: string;
  readonly travelZone: 0 | 1 | 2;
}

export const WAITLIST_POLICY = { maxJoinsPerPhonePerDay: 3, maxMonthsAhead: 18 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

/** Today in IST as YYYY-MM-DD, and the same date `months` later. */
function dateWindow(now: Date, months: number): { from: string; to: string } {
  const from = IST_DATE.format(now);
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const to = new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
  return { from, to };
}

/** The pincode gate (v0.2 §7). WAITLIST and BLOCKED pincodes never produce a booking (Invariant 23). */
@Injectable()
export class ServiceabilityService {
  constructor(
    @Inject(SERVICEABILITY_REPOSITORY) private readonly repo: ServiceabilityRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async check(pincode: string): Promise<ServiceabilityResult> {
    const area = await this.repo.findArea(pincode);
    if (area && (area.status === 'LIVE' || area.status === 'PILOT')) {
      return {
        bookable: true,
        pincode,
        status: area.status,
        areaName: area.areaName,
        city: { id: area.city.id, name: area.city.name, tier: area.city.tier },
        travelZone: area.travelZone,
        limitedAvailability: area.status === 'PILOT',
      };
    }
    const blocked = area?.status === 'BLOCKED';
    return {
      bookable: false,
      pincode,
      status: area ? (area.status as 'WAITLIST' | 'BLOCKED') : 'UNKNOWN',
      cityName: area?.city.name ?? null,
      canJoinWaitlist: !blocked,
      waitingCount: blocked ? 0 : await this.repo.countWaiting(area?.city.id ?? null, pincode),
    };
  }

  async join(body: JoinWaitlistBody): Promise<JoinWaitlistResponse> {
    const area = await this.repo.findArea(body.pincode);
    if (area?.status === 'LIVE' || area?.status === 'PILOT') {
      throw new ConflictException({
        code: 'ALREADY_SERVICEABLE',
        message: 'We already serve this pincode — book now',
      });
    }
    if (area?.status === 'BLOCKED') {
      throw new UnprocessableEntityException({
        code: 'NOT_SERVICEABLE',
        message: 'We cannot serve this pincode',
      });
    }
    const now = this.clock();
    if (body.intendedDate) {
      const { from, to } = dateWindow(now, WAITLIST_POLICY.maxMonthsAhead);
      if (body.intendedDate < from || body.intendedDate > to) {
        throw new UnprocessableEntityException({
          code: 'DATE_OUT_OF_RANGE',
          message: `Pick a date between ${from} and ${to}`,
        });
      }
    }
    const dayAgo = new Date(now.getTime() - DAY_MS);
    if (
      (await this.repo.countForPhoneSince(body.phone, dayAgo)) >=
      WAITLIST_POLICY.maxJoinsPerPhonePerDay
    ) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many waitlist requests for this number today' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const cityId = area?.city.id ?? null;
    await this.repo.insertWaitlist({
      phone: body.phone,
      fullName: body.fullName,
      pincode: body.pincode,
      cityId,
      cityNameRaw: body.cityNameRaw ?? null,
      intendedDate: body.intendedDate ?? null,
      intendedTier: body.intendedTier ?? null,
    });
    return { joined: true, waitingCount: await this.repo.countWaiting(cityId, body.pincode) };
  }

  /**
   * The venue facts pricing needs. Only LIVE/PILOT pincodes resolve: a quote can
   * never exist for a WAITLIST, BLOCKED or unknown pincode (Invariant 23).
   */
  async resolveVenue(pincode: string): Promise<BookableVenue> {
    const area = await this.repo.findArea(pincode);
    if (!area || (area.status !== 'LIVE' && area.status !== 'PILOT')) {
      throw new UnprocessableEntityException({
        code: 'NOT_SERVICEABLE',
        message: 'We do not serve this pincode yet — join the waitlist',
      });
    }
    return {
      pincode,
      cityId: area.city.id,
      cityName: area.city.name,
      cityTier: area.city.tier,
      state: area.city.state,
      travelZone: area.travelZone,
    };
  }

  cityNames(cityIds: readonly string[]): Promise<Map<string, string>> {
    return this.repo.cityNames(cityIds);
  }

  /**
   * Dispatch's venue fallback when a booking has no geocoded point (ADR-0010): the pincode
   * centroid, else the city centre. An opaque geography value (hex EWKB); null for an unknown pincode.
   */
  async venueFallbackPoint(pincode: string): Promise<string | null> {
    return (await this.venueFallback(pincode))?.point ?? null;
  }

  /** The same fallback, saying which point it is (the on-site geofence records it, ADR-0013 D3). */
  async venueFallback(pincode: string): Promise<VenueFallback | null> {
    const points = await this.repo.venuePoints(pincode);
    if (!points) return null;
    return points.centroid
      ? { point: points.centroid, basis: 'PINCODE_CENTROID' }
      : { point: points.cityCentre, basis: 'CITY_CENTRE' };
  }

  areaLabels(pincodes: readonly string[]): Promise<Map<string, AreaLabel>> {
    return this.repo.areaLabels(pincodes);
  }
}
