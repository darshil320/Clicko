import { isApiError } from '@clickco/api-client';
import type { BookingDetail, BookingStatus } from '@clickco/contracts';
import { userMessage } from '@/shared/errors';
import { formatDayMonth } from '@/shared/format/datetime';

/**
 * "Report a problem with my photos" (ADR-0027 D5): a DELIVERED booking, within 30 days of
 * delivery, one open issue at a time. The server decides; this only chooses what to offer and
 * says its refusals in plain words. Pure, so it is tested.
 */

type TimelineEntry = BookingDetail['timeline'][number];

/** The API's window (care-rules: qualityReportWindowDays). */
export const QUALITY_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export type ReportWindow =
  | { readonly kind: 'open'; readonly closesAt: Date }
  | { readonly kind: 'reported' }
  | { readonly kind: 'hidden' };

/** When the photos were delivered: the first move into DELIVERED on the booking's timeline. */
export function deliveredAt(timeline: readonly TimelineEntry[]): Date | null {
  const entries = timeline
    .filter((entry) => entry.toStatus === 'DELIVERED')
    .map((entry) => Date.parse(entry.occurredAt))
    .filter((ms) => !Number.isNaN(ms));
  return entries.length === 0 ? null : new Date(Math.min(...entries));
}

/** Offer the report only while the server would take it; say so once one is under review. */
export function reportWindow(
  status: BookingStatus,
  timeline: readonly TimelineEntry[],
  now: Date,
): ReportWindow {
  if (status === 'QUALITY_ESCALATION') return { kind: 'reported' };
  if (status !== 'DELIVERED') return { kind: 'hidden' };
  const delivered = deliveredAt(timeline);
  if (!delivered) return { kind: 'hidden' };
  const closesAt = new Date(delivered.getTime() + QUALITY_WINDOW_DAYS * DAY_MS);
  return now.getTime() < closesAt.getTime() ? { kind: 'open', closesAt } : { kind: 'hidden' };
}

/** "Tell us by 2 Dec" */
export const windowLine = (closesAt: Date): string =>
  `Tell us by ${formatDayMonth(closesAt)} and our quality team will look into it.`;

const ALREADY_OPEN = 'QUALITY_ISSUE_ALREADY_OPEN';

/** The 409s from POST /bookings/:id/quality-issue, in the client's words. */
const REFUSALS: Readonly<Record<string, string>> = {
  [ALREADY_OPEN]: "You've already reported a problem with this booking. We're looking into it.",
  BOOKING_NOT_DELIVERED: 'You can report a problem once your photos are delivered.',
  QUALITY_WINDOW_CLOSED:
    'Problems with photos can be reported up to 30 days after delivery. For anything else, get help from the Help tab.',
  BOOKING_NOT_FOUND: "We can't find this booking on your account.",
};

export function qualityErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === 'HTTP') {
    const words = REFUSALS[error.code];
    if (words) return words;
  }
  return userMessage(error);
}

/** Refusals a retry can't change: the form keeps the reason and disables Send. */
const FINAL_REFUSALS: ReadonlySet<string> = new Set([
  'QUALITY_WINDOW_CLOSED',
  'BOOKING_NOT_DELIVERED',
  'BOOKING_NOT_FOUND',
]);

export const isFinalRefusal = (error: unknown): boolean =>
  isApiError(error) && error.kind === 'HTTP' && FINAL_REFUSALS.has(error.code);

/** The server already has an open report: show the "under review" state, not an error. */
export const isAlreadyReported = (error: unknown): boolean =>
  isApiError(error) && error.code === ALREADY_OPEN;
