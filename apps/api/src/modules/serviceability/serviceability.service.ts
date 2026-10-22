import type {
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
        city: area.city,
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
}
