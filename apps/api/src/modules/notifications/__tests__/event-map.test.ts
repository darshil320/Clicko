import { describe, expect, it } from 'vitest';
import type { PublishedEvent } from '../../../infra/outbox/outbox-subscribers';
import type { BookingContactFacts } from '../../bookings/bookings.types';
import {
  EVENT_MAP,
  type EventContext,
  MAPPED_EVENT_TYPES,
  mappingFor,
  mappingsFor,
} from '../pipeline/event-map';
import { TEMPLATE_CODES, templateOf, validateVariables } from '../templates/templates';

const BOOKING = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PRO = '33333333-3333-4333-8333-333333333333';
const PRO_2 = '44444444-4444-4444-8444-444444444444';
const ASSIGNMENT = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-14T06:30:00Z'); // 12:00 IST
const TOKEN = 'c'.repeat(43);

const facts = (over: Partial<BookingContactFacts> = {}): BookingContactFacts => ({
  bookingId: BOOKING,
  reference: 'CLK-1042',
  status: 'CONFIRMED',
  userId: USER,
  scheduledStart: new Date('2026-11-15T11:00:00Z'), // Sun 15 Nov, 4:30 pm IST
  subjectPhone: null,
  galleryRecipient: 'BOOKER',
  ...over,
});

function ctx(
  over: Partial<Omit<EventContext, 'booking'>> & { booking?: BookingContactFacts | null } = {},
) {
  const booking = 'booking' in over ? over.booking : facts();
  const base: EventContext = {
    now: NOW,
    virtualNumber: '+918047112233',
    booking: async () => booking ?? null,
    photographerName: async () => 'Meera Joshi',
    currentAssignment: async () => ({ assignmentId: ASSIGNMENT, photographerId: PRO }),
    deliveryLinkToken: async () => TOKEN,
    userPhone: async () => '+919700000001',
  };
  const { booking: _ignored, ...rest } = over;
  return { ...base, ...rest } as EventContext;
}

const event = (
  eventType: string,
  payload: Record<string, unknown> = {},
  aggregateId = BOOKING,
): PublishedEvent => ({
  eventId: '66666666-6666-4666-8666-666666666666',
  eventType,
  aggregateKind: 'booking',
  aggregateId,
  payload: { booking_id: BOOKING, ...payload },
  occurredAt: NOW,
});

async function resolve(type: string, e: PublishedEvent, c: EventContext = ctx()) {
  const [mapping] = mappingsFor(type);
  if (!mapping) throw new Error(`unmapped ${type}`);
  return mapping.resolve(e, c);
}

/** Resolves and validates: what the sender would send. */
async function only(type: string, e: PublishedEvent, c: EventContext = ctx()) {
  const intents = await resolve(type, e, c);
  expect(intents).toHaveLength(1);
  const [i] = intents;
  const def = templateOf(mappingsFor(type)[0]?.template ?? '');
  if (!i || !def) throw new Error('no intent');
  return { ...i, variables: validateVariables(def, i.variables) };
}

describe('event map (ADR-0027 D2)', () => {
  it('maps each template to exactly one existing event', () => {
    const mapped = EVENT_MAP.map((m) => m.template);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual([...TEMPLATE_CODES].sort());
    expect(MAPPED_EVENT_TYPES).toContain('booking.confirmed');
    expect(mappingFor('booking.confirmed', 'BOOKING_CONFIRMED')?.template).toBe(
      'BOOKING_CONFIRMED',
    );
    expect(mappingFor('booking.confirmed', 'DELIVERED')).toBeNull();
    expect(mappingsFor('booking.drafted')).toEqual([]);
  });

  it('booking confirmed → the client, with the reference and IST time', async () => {
    const i = await only('booking.confirmed', event('booking.confirmed'));
    expect(i.recipient).toEqual({ kind: 'USER', id: USER });
    expect(i.variables).toEqual({ bookingRef: 'CLK-1042', when: 'Sun 15 Nov, 4:30 pm' });
    expect(i.data).toEqual({ template: 'BOOKING_CONFIRMED', bookingId: BOOKING });
  });

  it('photographer assigned → first name and the virtual number, never a real one', async () => {
    const e = event('booking.assigned', { assignment_id: ASSIGNMENT, photographer_id: PRO });
    const i = await only('booking.assigned', e);
    expect(i.variables).toEqual({
      bookingRef: 'CLK-1042',
      photographerName: 'Meera',
      when: 'Sun 15 Nov, 4:30 pm',
      callNumber: '+918047112233',
    });
  });

  it('a stale assignment (replaced since) resolves to nothing', async () => {
    const e = event('booking.assigned', { assignment_id: 'old-assignment' });
    expect(await resolve('booking.assigned', e)).toEqual([]);
    expect(
      await resolve('booking.en_route', event('booking.en_route', { assignment_id: 'x' })),
    ).toEqual([]);
  });

  it('on the way → the first name, only while the booking is still en route', async () => {
    const e = event('booking.en_route', { assignment_id: ASSIGNMENT });
    const enRoute = ctx({ booking: facts({ status: 'EN_ROUTE' }) });
    expect((await only('booking.en_route', e, enRoute)).variables).toEqual({
      bookingRef: 'CLK-1042',
      photographerName: 'Meera',
    });
    // A check-in walks ASSIGNED → EN_ROUTE → CHECKED_IN at once: only "arrived" goes.
    const arrived = ctx({ booking: facts({ status: 'CHECKED_IN' }) });
    expect(await resolve('booking.en_route', e, arrived)).toEqual([]);
  });

  it('a name outside the vetted pattern leaves a null variable (the send is skipped)', async () => {
    const e = event('booking.en_route', { assignment_id: ASSIGNMENT });
    const odd = ctx({
      booking: facts({ status: 'EN_ROUTE' }),
      photographerName: async () => '42',
    });
    const [i] = await resolve('booking.en_route', e, odd);
    expect(i?.variables.photographerName).toBeNull();
  });

  it('check-in → the client and, per G-08, the person at the venue on their own number', async () => {
    const e = event('booking.checked_in', { assignment_id: ASSIGNMENT });
    const withSubject = ctx({ booking: facts({ subjectPhone: '+919800000002' }) });
    const intents = await resolve('booking.checked_in', e, withSubject);
    expect(intents.map((i) => i.recipient)).toEqual([
      { kind: 'USER', id: USER },
      { kind: 'SUBJECT', id: BOOKING },
    ]);
    // The same number as the account: one message.
    const same = ctx({ booking: facts({ subjectPhone: '+919700000001' }) });
    expect(await resolve('booking.checked_in', e, same)).toHaveLength(1);
  });

  it('extension request → minutes and price, only inside its 10-minute window', async () => {
    const open = event('assignment.extension_requested', {
      assignment_id: ASSIGNMENT,
      minutes: 60,
      amount_paise: 339_840,
      expires_at: new Date(NOW.getTime() + 600_000).toISOString(),
    });
    const i = await only('assignment.extension_requested', open);
    expect(i.variables).toEqual({ bookingRef: 'CLK-1042', minutes: '60', amount: '₹3,398.40' });
    const lapsed = event('assignment.extension_requested', {
      ...open.payload,
      expires_at: NOW.toISOString(),
    });
    expect(await resolve('assignment.extension_requested', lapsed)).toEqual([]);
  });

  it('balance due: nothing when nothing is due; reminder only while still unpaid', async () => {
    const due = await only(
      'booking.balance_pending',
      event('booking.balance_pending', { balance_due_paise: 576_725 }),
    );
    expect(due.variables).toEqual({ bookingRef: 'CLK-1042', amount: '₹5,767.25' });
    expect(
      await resolve(
        'booking.balance_pending',
        event('booking.balance_pending', { balance_due_paise: 0 }),
      ),
    ).toEqual([]);
    const reminder = event('booking.balance_reminder', { balance_paise: 576_725, sequence: 1 });
    const pending = ctx({ booking: facts({ status: 'BALANCE_PENDING' }) });
    expect((await only('booking.balance_reminder', reminder, pending)).variables.amount).toBe(
      '₹5,767.25',
    );
    const paid = ctx({ booking: facts({ status: 'DELIVERED' }) });
    expect(await resolve('booking.balance_reminder', reminder, paid)).toEqual([]);
  });

  it('delivered → the gallery recipient with the link token', async () => {
    const e = event('booking.delivered', { link_ids: [] });
    expect((await only('booking.delivered', e)).recipient).toEqual({ kind: 'USER', id: USER });
    const toSubject = ctx({
      booking: facts({ galleryRecipient: 'SUBJECT', subjectPhone: '+919800000002' }),
    });
    const i = await only('booking.delivered', e, toSubject);
    expect(i.recipient).toEqual({ kind: 'SUBJECT', id: BOOKING });
    expect(i.variables).toEqual({ bookingRef: 'CLK-1042', linkToken: TOKEN });
  });

  it('refund processed and credit issued → the client', async () => {
    const refund = {
      ...event('refund.processed', { amount_paise: 100_000 }),
      aggregateKind: 'refund',
    };
    const r = await only('refund.processed', { ...refund, aggregateId: 'refund-id' });
    expect(r.variables).toEqual({ bookingRef: 'CLK-1042', amount: '₹1,000' });
    const credit = event(
      'credit.issued',
      { user_id: USER, amount_paise: 50_000, expires_at: '2027-05-14T18:29:59.000Z' },
      'credit-id',
    );
    const c = await only('credit.issued', credit);
    expect(c.recipient).toEqual({ kind: 'USER', id: USER });
    expect(c.variables).toEqual({ amount: '₹500', expiresOn: '14 May 2027' });
  });

  it('a wave → a push to every photographer offered, while the offer is open', async () => {
    const e = event('dispatch.wave_opened', {
      photographer_ids: [PRO, PRO_2],
      offered_payout_paise: 510_000,
      expires_at: new Date(NOW.getTime() + 120_000).toISOString(),
    });
    const intents = await resolve('dispatch.wave_opened', e);
    expect(intents.map((i) => i.recipient)).toEqual([
      { kind: 'PHOTOGRAPHER', id: PRO },
      { kind: 'PHOTOGRAPHER', id: PRO_2 },
    ]);
    expect(intents[0]?.variables).toEqual({ when: 'Sun 15 Nov, 4:30 pm', amount: '₹5,100' });
    const closed = event('dispatch.wave_opened', { ...e.payload, expires_at: NOW.toISOString() });
    expect(await resolve('dispatch.wave_opened', closed)).toEqual([]);
  });

  it('payout paid → the photographer, with the UTR tail only', async () => {
    const e = event(
      'payout.transfer_paid',
      { photographer_id: PRO, net_paise: 1_234_500, utr: 'HDFCR52026111412345678' },
      PRO,
    );
    const i = await only('payout.transfer_paid', e);
    expect(i.recipient).toEqual({ kind: 'PHOTOGRAPHER', id: PRO });
    expect(i.variables).toEqual({ amount: '₹12,345', utrLast4: '5678' });
    expect(i.bookingId).toBeNull();
  });

  it('a booking that no longer exists resolves to nothing', async () => {
    expect(
      await resolve('booking.confirmed', event('booking.confirmed'), ctx({ booking: null })),
    ).toEqual([]);
  });
});
