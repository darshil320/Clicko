import { isApiError } from '@clickco/api-client';
import {
  type BookingSummary,
  type ClientTicket,
  ClientTicketBody,
  GRIEVANCE_ACK_HOURS,
  GRIEVANCE_RESOLVE_DAYS,
  TicketCategory,
  type TicketStatus,
} from '@clickco/contracts';
import type { BadgeTone } from '@clickco/ui';
import { z } from 'zod';
import { categoryLabel as shootCategoryLabel } from '@/shared/catalogue';
import { userMessage } from '@/shared/errors';
import { formatDateTime, formatDayMonth } from '@/shared/format/datetime';

/**
 * Support tickets in the client's words (ADR-0027 D5, SA-02, T&C §12): what a ticket can be
 * about, where it stands, and when to expect an answer. Pure, so every line is tested.
 */

export interface CategoryChoice {
  readonly value: TicketCategory;
  readonly label: string;
}

/** The order people reach for them; every API category exactly once (tested). */
export const CATEGORY_CHOICES: readonly CategoryChoice[] = [
  { value: 'BILLING', label: 'Payments & refunds' },
  { value: 'QUALITY', label: 'Photo quality' },
  { value: 'CONDUCT', label: 'Photographer behaviour' },
  { value: 'APP_ISSUE', label: 'App not working' },
  { value: 'GRIEVANCE', label: 'Make a complaint' },
  { value: 'DATA_DELETION', label: 'Delete my data' },
  { value: 'CONSENT_WITHDRAWAL', label: 'Withdraw my consent' },
  { value: 'OTHER', label: 'Something else' },
];

export interface TicketStatusView {
  readonly label: string;
  readonly tone: BadgeTone;
}

const STATUS: Readonly<Record<TicketStatus, TicketStatusView>> = {
  OPEN: { label: 'Received', tone: 'neutral' },
  ACKNOWLEDGED: { label: 'Seen by our team', tone: 'accent' },
  IN_PROGRESS: { label: 'Working on it', tone: 'accent' },
  AWAITING_CUSTOMER: { label: 'Needs your reply', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

export const ticketStatus = (status: TicketStatus): TicketStatusView => STATUS[status];

/** "4 Nov, 10:00 am", with "am" kept on the time's line. */
const at = (iso: string): string => formatDateTime(iso).replace(/ (am|pm)$/, '\u00a0$1');

/** "Sent 2 Nov, 10:00 am" */
export const sentAtLine = (ticket: ClientTicket): string => `Sent ${at(ticket.receivedAt)}`;

/** The promise in the form's subtitle, from the statutory clocks (T&C §12). */
export const RESPONSE_PROMISE = `We reply within ${GRIEVANCE_ACK_HOURS} hours and sort most things out within ${GRIEVANCE_RESOLVE_DAYS} days.`;

/**
 * When the client can expect something, in plain words: the reply (48 h) until support has
 * acknowledged it, then the fix (30 days), and what happened once it is done.
 */
export function deadlineLine(ticket: ClientTicket, now: Date): string {
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    const done = ticket.resolvedAt ?? null;
    return done ? `Sorted on ${formatDayMonth(new Date(done))}` : 'This ticket is closed';
  }
  if (ticket.status === 'AWAITING_CUSTOMER') {
    return 'Our team will call or message you for a few details.';
  }
  if (ticket.acknowledgedAt === null) {
    return now.getTime() < Date.parse(ticket.ackDueAt)
      ? `We'll reply by ${at(ticket.ackDueAt)}`
      : "Our reply is late. It's at the top of our list.";
  }
  return now.getTime() < Date.parse(ticket.resolveDueAt)
    ? `We'll sort it out by ${formatDayMonth(new Date(ticket.resolveDueAt))}`
    : "This is taking longer than it should. It's at the top of our list.";
}

// ── The form ────────────────────────────────────────────────────────────────

export const TicketForm = z.object({
  category: z.enum(TicketCategory.options, { error: 'Pick what this is about' }),
  /** null: not about a booking. */
  bookingId: z.string().nullable(),
  message: ClientTicketBody.shape.message,
});
export type TicketForm = z.infer<typeof TicketForm>;

/** The POST /me/tickets body: trimmed, and without a booking when it is about none. */
export function toTicketBody(form: TicketForm): ClientTicketBody {
  return {
    category: form.category,
    message: form.message.trim(),
    ...(form.bookingId ? { bookingId: form.bookingId } : {}),
  };
}

export interface BookingChoice {
  readonly id: string;
  /** "Food · 14 Sep" */
  readonly label: string;
}

const RECENT_BOOKINGS = 5;

const choiceOf = (booking: BookingSummary): BookingChoice => ({
  id: booking.id,
  label: `${shootCategoryLabel(booking.categoryCode)} · ${formatDayMonth(new Date(booking.scheduledStart))}`,
});

/**
 * The bookings a ticket can be about: the most recent shoots, plus the one the client came from
 * (from a booking's "Get help") even when it is older.
 */
export function bookingChoices(
  bookings: readonly BookingSummary[],
  preselectedId: string | null,
  limit = RECENT_BOOKINGS,
): readonly BookingChoice[] {
  const recent = [...bookings]
    .sort((a, b) => Date.parse(b.scheduledStart) - Date.parse(a.scheduledStart))
    .slice(0, limit);
  const preselected = bookings.find((b) => b.id === preselectedId);
  const withPreselected =
    preselected && !recent.some((b) => b.id === preselected.id) ? [preselected, ...recent] : recent;
  return withPreselected.map(choiceOf);
}

/** A failed send in plain words; the API's own sentences (e.g. the daily limit) pass through. */
export function ticketErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === 'BOOKING_NOT_FOUND') {
    return "That booking isn't on your account. Pick another one, or send it without a booking.";
  }
  return userMessage(error);
}

/** After sending: when we will reply. */
export const replyByLine = (ticket: ClientTicket): string =>
  `We'll reply by ${at(ticket.ackDueAt)}.`;
