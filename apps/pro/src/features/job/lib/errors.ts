import { isApiError } from '@clickco/api-client';
import { z } from 'zod';
import { userMessage } from '@/shared/errors';
import { formatDateTime } from '@/shared/format/datetime';
import type { OnsiteActionKind } from '@/shared/offline/queue';
import { formatClock } from './timing';

/**
 * The API's on-site refusals (ADR-0013 D15, apps/api/src/modules/onsite) in words a photographer
 * standing at a gate can act on. Details are parsed defensively: without them the server's own
 * message (already written for people) is shown.
 */

export type JobAction = OnsiteActionKind | 'CANCEL';

export interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export const MOCKED_LOCATION_MESSAGE =
  'This phone is reporting a mock location. Turn off mock locations in Developer options, then try again.';

export const tooRoughMessage = (maxAccuracyM: number): string =>
  `Your GPS fix isn't precise enough — it needs to be ±${maxAccuracyM} m or better. Step outside or near a window and try again.`;

const GeofenceDetails = z.object({ distanceM: z.number(), limitM: z.number() });
const AccuracyDetails = z.object({ maxAccuracyM: z.number() });
const OpensDetails = z.object({ opensAt: z.string() });
const EarliestDetails = z.object({ earliestCheckOutAt: z.string() });
const ElapsedDetails = z.object({ elapsedMinutes: z.number() });
const RetryDetails = z.object({ retryAt: z.string() });

const KILOMETRE = 1000;

/** "240 m", "2.4 km". */
export function formatDistance(metres: number): string {
  return metres < KILOMETRE ? `${Math.round(metres)} m` : `${(metres / KILOMETRE).toFixed(1)} km`;
}

const GEOFENCED_VERB: Partial<Record<JobAction, string>> = {
  CHECK_IN: 'check in',
  CHECK_OUT: 'check out',
  CLIENT_ABSENT: 'report the client absent',
};

/** Fixed sentences for refusals that need no details. */
const PLAIN: Readonly<Record<string, string>> = {
  LOCATION_MOCKED: MOCKED_LOCATION_MESSAGE,
  EXTENSION_PENDING: "The client hasn't answered your last extension request yet.",
  EXTENSION_LIMIT: 'This shoot has already been extended as many times as allowed.',
  WAITING_ALREADY_LOGGED: 'Waiting time is already logged for this shoot — it can be logged once.',
  CHECK_IN_ALREADY_RECORDED: "You're already checked in for this shoot.",
  CHECK_OUT_ALREADY_RECORDED: "You've already checked out of this shoot.",
  ASSIGNMENT_NOT_ACTIVE: 'This job is no longer active on your account.',
  ASSIGNMENT_NOT_FOUND: 'This job is no longer on your account.',
  WRONG_STAGE:
    "That can't be done at this stage of the shoot. Pull down to refresh and see where it stands.",
};

type Describer = (refusal: Refusal, action: JobAction) => string | null;

const DESCRIBE: Readonly<Record<string, Describer>> = {
  OUTSIDE_GEOFENCE: ({ details }, action) => {
    const parsed = GeofenceDetails.safeParse(details);
    if (!parsed.success) return null;
    const verb = GEOFENCED_VERB[action] ?? 'do this';
    return `You're ${formatDistance(parsed.data.distanceM)} from the venue — ${verb} within ${formatDistance(parsed.data.limitM)}.`;
  },
  LOCATION_TOO_INACCURATE: ({ details }) => {
    const parsed = AccuracyDetails.safeParse(details);
    return parsed.success ? tooRoughMessage(parsed.data.maxAccuracyM) : null;
  },
  TOO_EARLY: ({ details }, action) => {
    const parsed = OpensDetails.safeParse(details);
    if (!parsed.success) return null;
    if (action === 'CLIENT_ABSENT') {
      return `You can report the client absent from ${formatClock(parsed.data.opensAt)} — 60 minutes after the start.`;
    }
    return `This opens at ${formatDateTime(parsed.data.opensAt)} — 3 hours before the shoot.`;
  },
  MINIMUM_DURATION_NOT_MET: ({ details }) => {
    const parsed = EarliestDetails.safeParse(details);
    return parsed.success
      ? `The booked time isn't over yet — you can check out from ${formatClock(parsed.data.earliestCheckOutAt)}.`
      : null;
  },
  WAITING_EXCEEDS_ELAPSED: ({ details }) => {
    const parsed = ElapsedDetails.safeParse(details);
    if (!parsed.success) return null;
    const n = parsed.data.elapsedMinutes;
    return n <= 0
      ? 'No time has passed since the start yet, so there is no waiting to log.'
      : `Only ${n} minutes have passed since the start — log ${n} or fewer.`;
  },
  EXTENSION_COOLDOWN: ({ details }) => {
    const parsed = RetryDetails.safeParse(details);
    return parsed.success
      ? `The client just declined — you can ask again at ${formatClock(parsed.data.retryAt)}.`
      : null;
  },
};

/** A server refusal (live, or a queued action the server later refused) as one sentence. */
export function describeRefusal(refusal: Refusal, action: JobAction): string {
  const plain = PLAIN[refusal.code];
  if (plain) return plain;
  return DESCRIBE[refusal.code]?.(refusal, action) ?? refusal.message;
}

/** Any error from a job action: the server's 4xx mapped; transport and 5xx in the shared words. */
export function jobErrorMessage(error: unknown, action: JobAction): string {
  if (isApiError(error) && error.kind === 'HTTP' && error.isClientError) {
    return describeRefusal(
      { code: error.code, message: error.message, details: error.details },
      action,
    );
  }
  return userMessage(error);
}
