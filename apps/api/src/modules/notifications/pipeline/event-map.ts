import type { PublishedEvent } from '../../../infra/outbox/outbox-subscribers';
import type { BookingContactFacts } from '../../bookings/bookings.types';
import type { Recipient } from '../notifications.types';
import type { TemplateCode } from '../templates/templates';
import {
  firstNameOf,
  formatIstDate,
  formatIstWhen,
  formatRupees,
  utrLast4,
} from '../templates/variables';

/**
 * What a mapping may read. Every reader goes through the owning module's service (bookings,
 * photographers, dispatch, delivery, calls, users) — notifications never queries their tables.
 */
export interface EventContext {
  readonly now: Date;
  /** The ExoPhone the client calls the photographer through (ADR-0027 D3). */
  readonly virtualNumber: string;
  booking(bookingId: string): Promise<BookingContactFacts | null>;
  /** The full name on the photographer's record (first name only reaches a message). */
  photographerName(photographerId: string): Promise<string | null>;
  /** The booking's most recent assignment. */
  currentAssignment(
    bookingId: string,
  ): Promise<{ readonly assignmentId: string; readonly photographerId: string } | null>;
  /** The public token of the booking's main delivery link. */
  deliveryLinkToken(bookingId: string): Promise<string | null>;
  userPhone(userId: string): Promise<string | null>;
}

/** One recipient's message. A null variable fails validation: the send is SKIPPED, not guessed. */
export interface NotificationIntent {
  readonly recipient: Recipient;
  readonly variables: Readonly<Record<string, string | null>>;
  readonly bookingId: string | null;
  /** Push deep-link data: ids and the template code only. */
  readonly data: Readonly<Record<string, string>>;
}

/**
 * A domain event → template → recipients and variables. `resolve` runs when the event is
 * published (to fan out one job per recipient) and again when each job runs (fresh variables;
 * a message whose moment has passed resolves to no intent for that recipient and is skipped).
 */
export interface EventMapping {
  readonly eventType: string;
  readonly template: TemplateCode;
  resolve(event: PublishedEvent, ctx: EventContext): Promise<readonly NotificationIntent[]>;
}

const str = (event: PublishedEvent, key: string): string | null => {
  const v = event.payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
};

const int = (event: PublishedEvent, key: string): number | null => {
  const v = event.payload[key];
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
};

const strings = (event: PublishedEvent, key: string): string[] => {
  const v = event.payload[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

const before = (iso: string | null, now: Date): boolean =>
  iso !== null && now.getTime() < new Date(iso).getTime();

/** An ISO instant from a payload as an IST "when"; null when it does not parse. */
const istWhenOf = (iso: string | null): string | null => {
  const at = iso === null ? Number.NaN : new Date(iso).getTime();
  return Number.isNaN(at) ? null : formatIstWhen(new Date(at));
};

const user = (b: BookingContactFacts): Recipient => ({ kind: 'USER', id: b.userId });
const subject = (b: BookingContactFacts): Recipient => ({ kind: 'SUBJECT', id: b.bookingId });

const intent = (
  recipient: Recipient,
  code: TemplateCode,
  bookingId: string | null,
  variables: Readonly<Record<string, string | null>>,
): NotificationIntent => ({
  recipient,
  variables,
  bookingId,
  data: bookingId ? { template: code, bookingId } : { template: code },
});

/** The client's message about a booking (the booking is the event's aggregate unless named). */
function toClient(
  code: TemplateCode,
  variables: (
    b: BookingContactFacts,
    event: PublishedEvent,
    ctx: EventContext,
  ) => Promise<Readonly<Record<string, string | null>> | null>,
  bookingIdOf: (event: PublishedEvent) => string | null = (e) => e.aggregateId,
): EventMapping['resolve'] {
  return async (event, ctx) => {
    const bookingId = bookingIdOf(event);
    const b = bookingId ? await ctx.booking(bookingId) : null;
    if (!b) return [];
    const vars = await variables(b, event, ctx);
    return vars ? [intent(user(b), code, b.bookingId, vars)] : [];
  };
}

/** The first name of the photographer on this assignment, if it is still the booking's current one. */
async function photographerOn(
  b: BookingContactFacts,
  event: PublishedEvent,
  ctx: EventContext,
): Promise<string | null | undefined> {
  const assignmentId = str(event, 'assignment_id');
  const current = await ctx.currentAssignment(b.bookingId);
  if (!current || current.assignmentId !== assignmentId) return undefined;
  const name = await ctx.photographerName(current.photographerId);
  return name ? firstNameOf(name) : null;
}

/**
 * The photographer's message about one of their payouts: its gross and the IST date of the shoot
 * it pays for (the Pro app lists jobs by date, not by booking reference). Never the withheld
 * reason or who released it: those are staff-written or staff identities.
 */
function toPhotographerAboutPayout(code: TemplateCode): EventMapping['resolve'] {
  return async (event, ctx) => {
    const photographerId = str(event, 'photographer_id');
    const bookingId = str(event, 'booking_id');
    if (!photographerId || !bookingId) return [];
    const b = await ctx.booking(bookingId);
    if (!b) return [];
    const gross = int(event, 'gross_paise');
    return [
      intent({ kind: 'PHOTOGRAPHER', id: photographerId }, code, b.bookingId, {
        amount: gross === null ? null : formatRupees(gross),
        shootDate: formatIstDate(b.scheduledStart),
      }),
    ];
  };
}

/** Every lifecycle template of ADR-0027 D2 whose domain event exists. */
export const EVENT_MAP: readonly EventMapping[] = [
  {
    eventType: 'booking.confirmed',
    template: 'BOOKING_CONFIRMED',
    resolve: toClient('BOOKING_CONFIRMED', async (b) => ({
      bookingRef: b.reference,
      when: formatIstWhen(b.scheduledStart),
    })),
  },
  {
    eventType: 'booking.assigned',
    template: 'PHOTOGRAPHER_ASSIGNED',
    resolve: toClient('PHOTOGRAPHER_ASSIGNED', async (b, event, ctx) => {
      const name = await photographerOn(b, event, ctx);
      if (name === undefined) return null; // replaced since: this message is stale
      return {
        bookingRef: b.reference,
        photographerName: name,
        when: formatIstWhen(b.scheduledStart),
        callNumber: ctx.virtualNumber,
      };
    }),
  },
  {
    eventType: 'booking.en_route',
    template: 'PHOTOGRAPHER_ON_THE_WAY',
    resolve: toClient('PHOTOGRAPHER_ON_THE_WAY', async (b, event, ctx) => {
      // Already checked in (a check-in walks ASSIGNED → EN_ROUTE itself): "arrived" says it all.
      if (b.status !== 'EN_ROUTE') return null;
      const name = await photographerOn(b, event, ctx);
      return name === undefined ? null : { bookingRef: b.reference, photographerName: name };
    }),
  },
  {
    // G-08: the booker and the person at the venue both hear about the check-in.
    eventType: 'booking.checked_in',
    template: 'CHECKED_IN',
    resolve: async (event, ctx) => {
      const b = await ctx.booking(event.aggregateId);
      if (!b) return [];
      const name = await photographerOn(b, event, ctx);
      if (name === undefined) return [];
      const vars = { bookingRef: b.reference, photographerName: name };
      const userPhone = b.subjectPhone ? await ctx.userPhone(b.userId) : null;
      const alsoSubject = b.subjectPhone !== null && b.subjectPhone !== userPhone;
      return [
        intent(user(b), 'CHECKED_IN', b.bookingId, vars),
        ...(alsoSubject ? [intent(subject(b), 'CHECKED_IN', b.bookingId, vars)] : []),
      ];
    },
  },
  {
    eventType: 'assignment.extension_requested',
    template: 'EXTENSION_REQUESTED',
    resolve: toClient('EXTENSION_REQUESTED', async (b, event, ctx) => {
      // The client has 10 minutes to answer: past that, the message is pointless.
      if (!before(str(event, 'expires_at'), ctx.now)) return null;
      const minutes = int(event, 'minutes');
      const amount = int(event, 'amount_paise');
      return {
        bookingRef: b.reference,
        minutes: minutes === null ? null : String(minutes),
        amount: amount === null ? null : formatRupees(amount),
      };
    }),
  },
  {
    eventType: 'booking.checked_out',
    template: 'CHECKED_OUT',
    resolve: toClient('CHECKED_OUT', async (b) => ({ bookingRef: b.reference })),
  },
  {
    eventType: 'booking.balance_pending',
    template: 'BALANCE_DUE',
    resolve: toClient('BALANCE_DUE', async (b, event) => {
      // Nothing to pay: the links are released at once and DELIVERED follows.
      const due = int(event, 'balance_due_paise');
      if (due === null || due <= 0) return null;
      return { bookingRef: b.reference, amount: formatRupees(due) };
    }),
  },
  {
    eventType: 'booking.balance_reminder',
    template: 'BALANCE_REMINDER',
    resolve: toClient('BALANCE_REMINDER', async (b, event) => {
      // Held through quiet hours: only if the balance is still unpaid when it goes.
      const due = int(event, 'balance_paise');
      if (b.status !== 'BALANCE_PENDING' || due === null || due <= 0) return null;
      return { bookingRef: b.reference, amount: formatRupees(due) };
    }),
  },
  {
    // G-08: the link goes to whoever the booker named as the gallery recipient.
    eventType: 'booking.delivered',
    template: 'DELIVERED',
    resolve: async (event, ctx) => {
      const b = await ctx.booking(event.aggregateId);
      if (!b) return [];
      const to = b.galleryRecipient === 'SUBJECT' && b.subjectPhone ? subject(b) : user(b);
      const linkToken = await ctx.deliveryLinkToken(b.bookingId);
      return [intent(to, 'DELIVERED', b.bookingId, { bookingRef: b.reference, linkToken })];
    },
  },
  {
    eventType: 'refund.processed',
    template: 'REFUND_ISSUED',
    resolve: toClient(
      'REFUND_ISSUED',
      async (b, event) => {
        const amount = int(event, 'amount_paise');
        return { bookingRef: b.reference, amount: amount === null ? null : formatRupees(amount) };
      },
      (e) => str(e, 'booking_id'),
    ),
  },
  {
    eventType: 'credit.issued',
    template: 'CREDIT_ISSUED',
    resolve: async (event) => {
      const userId = str(event, 'user_id');
      if (!userId) return [];
      const amount = int(event, 'amount_paise');
      const expires = str(event, 'expires_at');
      return [
        intent({ kind: 'USER', id: userId }, 'CREDIT_ISSUED', str(event, 'booking_id'), {
          amount: amount === null ? null : formatRupees(amount),
          expiresOn: expires ? formatIstDate(new Date(expires)) : null,
        }),
      ];
    },
  },
  {
    // A client raised a ticket in the app (ADR-0027 D5). The reply-by time is the ticket's own
    // acknowledgement deadline (48 h, T&C §12). Never the client's words or the category.
    eventType: 'ticket.raised',
    template: 'TICKET_RECEIVED',
    resolve: async (event) => {
      const userId = str(event, 'user_id');
      if (str(event, 'raised_by_kind') !== 'USER' || !userId) return [];
      return [
        intent({ kind: 'USER', id: userId }, 'TICKET_RECEIVED', str(event, 'booking_id'), {
          ticketRef: str(event, 'reference'),
          replyBy: istWhenOf(str(event, 'ack_due_at')),
        }),
      ];
    },
  },
  {
    // Push only: every photographer offered the wave, while the offer is open.
    eventType: 'dispatch.wave_opened',
    template: 'PRO_NEW_OFFER',
    resolve: async (event, ctx) => {
      if (!before(str(event, 'expires_at'), ctx.now)) return [];
      const b = await ctx.booking(event.aggregateId);
      if (!b) return [];
      const payout = int(event, 'offered_payout_paise');
      const vars = {
        when: formatIstWhen(b.scheduledStart),
        amount: payout === null ? null : formatRupees(payout),
      };
      return strings(event, 'photographer_ids').map((id) =>
        intent({ kind: 'PHOTOGRAPHER', id }, 'PRO_NEW_OFFER', b.bookingId, vars),
      );
    },
  },
  {
    eventType: 'payout.transfer_paid',
    template: 'PRO_PAYOUT_PAID',
    resolve: async (event) => {
      const photographerId = str(event, 'photographer_id');
      if (!photographerId) return [];
      const net = int(event, 'net_paise');
      return [
        intent({ kind: 'PHOTOGRAPHER', id: photographerId }, 'PRO_PAYOUT_PAID', null, {
          amount: net === null ? null : formatRupees(net),
          utrLast4: utrLast4(str(event, 'utr')),
        }),
      ];
    },
  },
  {
    // A data loss past the yearly cap (ADR-0027 D5a): written WITHHELD, the photographer told.
    eventType: 'payout.withheld',
    template: 'PRO_PAYOUT_ON_HOLD',
    resolve: toPhotographerAboutPayout('PRO_PAYOUT_ON_HOLD'),
  },
  {
    // Finance released a withheld payout: it joins the next batch it falls due for.
    eventType: 'payout.released',
    template: 'PRO_PAYOUT_RELEASED',
    resolve: toPhotographerAboutPayout('PRO_PAYOUT_RELEASED'),
  },
];

/** The event types the pipeline subscribes to. */
export const MAPPED_EVENT_TYPES: readonly string[] = [
  ...new Set(EVENT_MAP.map((m) => m.eventType)),
];

export const mappingsFor = (eventType: string): readonly EventMapping[] =>
  EVENT_MAP.filter((m) => m.eventType === eventType);

export const mappingFor = (eventType: string, template: string): EventMapping | null =>
  EVENT_MAP.find((m) => m.eventType === eventType && m.template === template) ?? null;
