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
  type CitySummary,
  SERVICEABILITY_REPOSITORY,
  type ServiceabilityRepository,
} from './repositories/serviceability.repository';
import type { AreaLabel, VenueFallback } from './serviceability.types';
import { sourceNetwork } from './source-network';

export interface BookableVenue {
  readonly pincode: string;
  readonly cityId: string;
  readonly cityName: string;
  readonly cityTier: CityTier;
  readonly state: string;
  readonly travelZone: 0 | 1 | 2;
}

/**
 * POST /waitlist is public, so every cap is counted from stored entries (audit Web M3). Network =
 * the client's IPv4 /24 or IPv6 /64 (sourceNetwork). Pincode caps stop one area being flooded;
 * they sit far above organic demand for a single pincode. A CAPTCHA (Cloudflare Turnstile) is a
 * follow-up that needs the owner's Cloudflare account.
 */
export const WAITLIST_POLICY = {
  maxJoinsPerPhonePerDay: 3,
  maxJoinsPerNetworkPerHour: 10,
  maxJoinsPerNetworkPerDay: 30,
  maxJoinsPerPincodePerHour: 60,
  maxJoinsPerPincodePerDay: 300,
  maxMonthsAhead: 18,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const rateLimited = (message: string) =>
  new HttpException({ code: 'RATE_LIMITED', message }, HttpStatus.TOO_MANY_REQUESTS);
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

  /**
   * Adds an unverified entry: nobody has proved they own the number, so it is never messaged until
   * verified (phone_verified_at, addendum 0013). `clientIp` is reduced to its /24 or /64.
   */
  async join(
    body: JoinWaitlistBody,
    clientIp: string | null = null,
  ): Promise<JoinWaitlistResponse> {
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
    const sourceNet = sourceNetwork(clientIp);
    await this.enforceJoinLimits(body, sourceNet, now);
    const cityId = area?.city.id ?? null;
    await this.repo.insertWaitlist({
      phone: body.phone,
      fullName: body.fullName,
      pincode: body.pincode,
      cityId,
      cityNameRaw: body.cityNameRaw ?? null,
      intendedDate: body.intendedDate ?? null,
      intendedTier: body.intendedTier ?? null,
      sourceNet,
    });
    return { joined: true, waitingCount: await this.repo.countWaiting(cityId, body.pincode) };
  }

  /** Per phone per day, then per network and per pincode per hour and per day (audit Web M3). */
  private async enforceJoinLimits(
    body: JoinWaitlistBody,
    sourceNet: string | null,
    now: Date,
  ): Promise<void> {
    const P = WAITLIST_POLICY;
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const dayAgo = new Date(now.getTime() - DAY_MS);
    if ((await this.repo.countForPhoneSince(body.phone, dayAgo)) >= P.maxJoinsPerPhonePerDay) {
      throw rateLimited('Too many waitlist requests for this number today');
    }
    if (sourceNet) {
      if (
        (await this.repo.countForNetworkSince(sourceNet, hourAgo)) >= P.maxJoinsPerNetworkPerHour ||
        (await this.repo.countForNetworkSince(sourceNet, dayAgo)) >= P.maxJoinsPerNetworkPerDay
      ) {
        throw rateLimited('Too many waitlist requests from this network — try again later');
      }
    }
    if (
      (await this.repo.countForPincodeSince(body.pincode, hourAgo)) >=
        P.maxJoinsPerPincodePerHour ||
      (await this.repo.countForPincodeSince(body.pincode, dayAgo)) >= P.maxJoinsPerPincodePerDay
    ) {
      throw rateLimited('Too many waitlist requests for this pincode — try again later');
    }
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

  /** `ids` null = every city. */
  cities(ids: readonly string[] | null): Promise<CitySummary[]> {
    return this.repo.cities(ids);
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
