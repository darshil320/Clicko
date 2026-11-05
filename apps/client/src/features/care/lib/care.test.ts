import { ApiError } from '@clickco/api-client';
import {
  type BookingDetail,
  type BookingSummary,
  type ClientTicket,
  TicketCategory,
  TicketStatus,
} from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  deliveredAt,
  isAlreadyReported,
  isFinalRefusal,
  qualityErrorMessage,
  reportWindow,
  windowLine,
} from './quality';
import {
  bookingChoices,
  CATEGORY_CHOICES,
  deadlineLine,
  RESPONSE_PROMISE,
  replyByLine,
  sentAtLine,
  TicketForm,
  ticketErrorMessage,
  ticketStatus,
  toTicketBody,
} from './tickets';

const http = (status: number, code: string, message = 'server words') =>
  new ApiError({ kind: 'HTTP', status, code, message });

const ticket = (over: Partial<ClientTicket> = {}): ClientTicket => ({
  id: '5b0e7c1a-9d2f-4e3b-8a6c-000000000001',
  reference: 'TKT-2026-00042',
  category: 'BILLING',
  subject: 'Refund not received',
  bookingId: null,
  status: 'OPEN',
  receivedAt: '2026-11-02T10:00:00+05:30',
  ackDueAt: '2026-11-04T10:00:00+05:30',
  acknowledgedAt: null,
  resolveDueAt: '2026-12-02T10:00:00+05:30',
  resolvedAt: null,
  resolutionSummary: null,
  ...over,
});

const NOW = new Date('2026-11-02T12:00:00+05:30');

describe('ticket wording', () => {
  it('offers every API category exactly once, each with a plain label', () => {
    expect(CATEGORY_CHOICES.map((c) => c.value).sort()).toEqual([...TicketCategory.options].sort());
    for (const choice of CATEGORY_CHOICES) expect(choice.label).not.toMatch(/_/);
  });

  it('names every status without codes', () => {
    for (const status of TicketStatus.options) {
      expect(ticketStatus(status).label).not.toMatch(/_|[A-Z]{3,}/);
    }
    expect(ticketStatus('RESOLVED')).toEqual({ label: 'Resolved', tone: 'success' });
  });

  it('promises the statutory clocks', () => {
    expect(RESPONSE_PROMISE).toBe(
      'We reply within 48 hours and sort most things out within 30 days.',
    );
  });
});

describe('deadlineLine', () => {
  it('gives the reply deadline until support has seen it', () => {
    expect(deadlineLine(ticket(), NOW)).toBe("We'll reply by 4 Nov, 10:00\u00a0am");
    expect(deadlineLine(ticket(), new Date('2026-11-05T10:00:00+05:30'))).toBe(
      "Our reply is late. It's at the top of our list.",
    );
  });

  it('then the date it will be sorted by', () => {
    const seen = ticket({ status: 'IN_PROGRESS', acknowledgedAt: '2026-11-02T11:00:00+05:30' });
    expect(deadlineLine(seen, NOW)).toBe("We'll sort it out by 2 Dec");
    expect(deadlineLine(seen, new Date('2026-12-03T10:00:00+05:30'))).toMatch(/longer than/);
  });

  it('says what happens when support needs the client, and when it is done', () => {
    expect(deadlineLine(ticket({ status: 'AWAITING_CUSTOMER' }), NOW)).toMatch(/call or message/);
    expect(
      deadlineLine(ticket({ status: 'RESOLVED', resolvedAt: '2026-11-03T15:00:00+05:30' }), NOW),
    ).toBe('Sorted on 3 Nov');
    expect(deadlineLine(ticket({ status: 'CLOSED' }), NOW)).toBe('This ticket is closed');
  });

  it('confirms a sent ticket with the reply time, and dates every ticket', () => {
    expect(replyByLine(ticket())).toBe("We'll reply by 4 Nov, 10:00\u00a0am.");
    expect(sentAtLine(ticket())).toBe('Sent 2 Nov, 10:00\u00a0am');
  });

  it('never lets "am" or "pm" wrap away from its time', () => {
    for (const line of [replyByLine(ticket()), sentAtLine(ticket()), deadlineLine(ticket(), NOW)])
      expect(line).not.toMatch(/ (am|pm)\b/);
  });
});

describe('the ticket form', () => {
  it('asks for a category and a real message', () => {
    const empty = TicketForm.safeParse({ bookingId: null, message: 'help' });
    expect(empty.success).toBe(false);
    const messages = empty.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain('Pick what this is about');
    expect(messages).toContain('Tell us what happened (10 or more characters)');
  });

  it('builds the body: trimmed, booking only when chosen', () => {
    expect(
      toTicketBody({ category: 'BILLING', bookingId: null, message: '  Refund still not here  ' }),
    ).toEqual({ category: 'BILLING', message: 'Refund still not here' });
    expect(
      toTicketBody({
        category: 'QUALITY',
        bookingId: '8e3f1a2b-4c5d-4e6f-9a0b-000000000001',
        message: 'Blurry photos everywhere',
      }),
    ).toMatchObject({ bookingId: '8e3f1a2b-4c5d-4e6f-9a0b-000000000001' });
  });

  it('puts the booking the client came from first, even when it is older', () => {
    const booking = (n: number, start: string): BookingSummary =>
      ({
        id: `8e3f1a2b-4c5d-4e6f-9a0b-00000000000${n}`,
        categoryCode: 'FOOD',
        scheduledStart: start,
      }) as BookingSummary;
    const list = [
      booking(1, '2026-09-14T10:00:00+05:30'),
      booking(2, '2026-11-01T10:00:00+05:30'),
      booking(3, '2026-10-20T10:00:00+05:30'),
    ];
    expect(bookingChoices(list, null, 2).map((c) => c.label)).toEqual([
      'Food · 1 Nov',
      'Food · 20 Oct',
    ]);
    expect(bookingChoices(list, list[0]?.id ?? null, 2).map((c) => c.label)).toEqual([
      'Food · 14 Sep',
      'Food · 1 Nov',
      'Food · 20 Oct',
    ]);
  });

  it('says a send failure in plain words, keeping the daily-limit sentence', () => {
    expect(ticketErrorMessage(http(404, 'BOOKING_NOT_FOUND', 'Booking not found'))).toMatch(
      /isn't on your account/,
    );
    expect(
      ticketErrorMessage(
        http(
          429,
          'RATE_LIMITED',
          'You have raised several tickets today. We will get back to you on those first.',
        ),
      ),
    ).toMatch(/several tickets today/);
  });
});

describe('quality report window', () => {
  const entry = (toStatus: BookingDetail['timeline'][number]['toStatus'], occurredAt: string) =>
    ({ fromStatus: null, toStatus, actorKind: 'SYSTEM', reason: null, occurredAt }) as const;
  const timeline = [
    entry('BALANCE_PENDING', '2026-10-20T10:00:00+05:30'),
    entry('DELIVERED', '2026-10-21T10:00:00+05:30'),
  ];

  it('dates delivery from the first move into DELIVERED', () => {
    expect(deliveredAt(timeline)?.toISOString()).toBe('2026-10-21T04:30:00.000Z');
    expect(deliveredAt([])).toBeNull();
  });

  it('is open for 30 days after delivery on a DELIVERED booking only', () => {
    const open = reportWindow('DELIVERED', timeline, NOW);
    expect(open.kind).toBe('open');
    if (open.kind === 'open')
      expect(windowLine(open.closesAt)).toBe(
        'Tell us by 20 Nov and our quality team will look into it.',
      );
    expect(reportWindow('DELIVERED', timeline, new Date('2026-11-21T10:00:00+05:30')).kind).toBe(
      'hidden',
    );
    expect(reportWindow('CLOSED', timeline, NOW).kind).toBe('hidden');
    expect(reportWindow('DELIVERED', [], NOW).kind).toBe('hidden');
    expect(reportWindow('QUALITY_ESCALATION', timeline, NOW).kind).toBe('reported');
  });

  it('puts every 409 in plain words and spots the already-reported case', () => {
    expect(qualityErrorMessage(http(409, 'QUALITY_WINDOW_CLOSED'))).toMatch(/up to 30 days/);
    expect(qualityErrorMessage(http(409, 'BOOKING_NOT_DELIVERED'))).toMatch(/once your photos/);
    expect(qualityErrorMessage(http(409, 'QUALITY_ISSUE_ALREADY_OPEN'))).toMatch(
      /already reported/,
    );
    expect(qualityErrorMessage(http(403, 'FORBIDDEN', 'Forbidden resource'))).toBe(
      "You don't have access to this.",
    );
    expect(isAlreadyReported(http(409, 'QUALITY_ISSUE_ALREADY_OPEN'))).toBe(true);
    expect(isAlreadyReported(http(409, 'QUALITY_WINDOW_CLOSED'))).toBe(false);
  });

  it('disables a retry only when the answer cannot change', () => {
    expect(isFinalRefusal(http(409, 'QUALITY_WINDOW_CLOSED'))).toBe(true);
    expect(isFinalRefusal(http(409, 'BOOKING_NOT_DELIVERED'))).toBe(true);
    expect(isFinalRefusal(http(500, 'ERROR'))).toBe(false);
    expect(
      isFinalRefusal(
        new ApiError({ kind: 'NETWORK', status: 0, code: 'TIMEOUT', message: 'timeout' }),
      ),
    ).toBe(false);
  });
});
