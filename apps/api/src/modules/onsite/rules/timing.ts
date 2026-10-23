/** ADR-0013 D5/D6/D7/D12 — pure time rules for on-site events. */
import { ONSITE_CONFIG } from '../onsite.config';

const MIN = 60_000;
const HOUR = 60 * MIN;

const plus = (d: Date, ms: number): Date => new Date(d.getTime() + ms);

export interface AuthoritativeTimeInput {
  readonly serverNow: Date;
  readonly deviceTs?: Date | undefined;
  readonly offline: boolean;
  /**
   * The earliest a device time may claim: max(calendar block start, acceptance, on-site opening).
   * Nothing on site can have happened before the photographer took the job.
   */
  readonly windowStart: Date;
  /** The event must come strictly after this (a check-out after its check-in). */
  readonly after?: Date | undefined;
}

/**
 * G-19: an offline event keeps its local timestamp when it is plausible — inside the assignment
 * window, at most 6 h old, at most 2 min in the future (clamped to now) and after `after`.
 * Anything else, and every online event, uses the server receive time.
 */
export function authoritativeTime(input: AuthoritativeTimeInput): {
  readonly at: Date;
  readonly usedDeviceTime: boolean;
} {
  const { serverNow, deviceTs, offline, windowStart, after } = input;
  const server = { at: serverNow, usedDeviceTime: false };
  if (!offline || !deviceTs) return server;
  const { maxAgeMinutes, maxFutureSkewMs } = ONSITE_CONFIG.offline;
  if (deviceTs.getTime() > serverNow.getTime() + maxFutureSkewMs) return server;
  const candidate = new Date(Math.min(deviceTs.getTime(), serverNow.getTime()));
  if (candidate < windowStart) return server;
  if (serverNow.getTime() - candidate.getTime() > maxAgeMinutes * MIN) return server;
  if (after && candidate <= after) return server;
  return { at: candidate, usedDeviceTime: true };
}

/** T&C §2.6 + DOMAIN §2: never before the scheduled start, never before the photographer arrived. */
export function billingStartsAt(checkInAt: Date, scheduledStart: Date): Date {
  return checkInAt > scheduledStart ? checkInAt : scheduledStart;
}

/**
 * Booked hours, plus approved one-hour extensions, plus CHARGED waiting minutes, from the billing
 * start (ADR-0013 D6/D9): waiting the client pays for is time on top of the booked block, so it is
 * never also taken out of the shoot (no double billing). The free grace is not added back.
 */
export function earliestCheckOutAt(
  billingStart: Date,
  scheduledHours: number,
  approvedExtensionHours: number,
  chargedWaitingMinutes = 0,
): Date {
  const minutes =
    Math.round(scheduledHours * 60) +
    approvedExtensionHours * ONSITE_CONFIG.extension.blockMinutes +
    chargedWaitingMinutes;
  return plus(billingStart, minutes * MIN);
}

/** The latest of several instants (the device-time floor). */
export function latestOf(first: Date, ...rest: readonly Date[]): Date {
  return new Date(Math.max(first.getTime(), ...rest.map((d) => d.getTime())));
}

/** En-route and check-in open 3 h before the start. */
export function onsiteOpensAt(scheduledStart: Date): Date {
  return plus(scheduledStart, -ONSITE_CONFIG.openLeadMinutes * MIN);
}

/** T&C §3.8: absent 60 min after the scheduled start. */
export function clientAbsentOpensAt(scheduledStart: Date): Date {
  return plus(scheduledStart, ONSITE_CONFIG.clientAbsentAfterMinutes * MIN);
}

/**
 * The most waiting that can be claimed: whole minutes from the billing start to the shoot start
 * (or to now, while the shoot has not started). Time spent shooting is never waiting (ADR-0013 D9).
 */
export function waitingElapsedMinutes(
  billingStart: Date,
  now: Date,
  shootStartedAt: Date | null = null,
): number {
  const end = shootStartedAt && shootStartedAt < now ? shootStartedAt : now;
  return Math.max(0, Math.floor((end.getTime() - billingStart.getTime()) / MIN));
}

/** DOMAIN §4 DELIVERY_DUE: T0 + 48 h; the RUSH_24H add-on promises 24 h. */
export function deliveryDueAt(slaT0: Date, rush: boolean): Date {
  const { standardHours, rushHours } = ONSITE_CONFIG.delivery;
  return plus(slaT0, (rush ? rushHours : standardHours) * HOUR);
}

/** When a pending extension request lapses. */
export function extensionExpiresAt(requestedAt: Date): Date {
  return plus(requestedAt, ONSITE_CONFIG.extension.expiryMinutes * MIN);
}
