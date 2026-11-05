import { BookingStatus } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  blockerKindFor,
  blockersFor,
  DELETION_ERASES,
  DELETION_KEEPS,
  forfeitedCredit,
} from '../deletion-rules';

const A = '6f1d2c3b-4a59-4e8f-9a7b-1c2d3e4f5a6b';
const B = '7a2e3d4c-5b6a-4f9e-8b7c-2d3e4f5a6b7c';

describe('which bookings stop a deletion (ADR-0030)', () => {
  it('a paid booking that is not finished, through every stage up to the balance', () => {
    for (const s of [
      'CONFIRMED',
      'DISPATCHING',
      'ASSIGNED',
      'EN_ROUTE',
      'CHECKED_IN',
      'IN_PROGRESS',
      'CHECKED_OUT',
      'UPLOADING',
      'PROCESSING',
      'QA',
      'BALANCE_PENDING',
      'UNSAFE_SITE',
    ] as const) {
      expect(blockerKindFor(s)).toBe('BOOKING_IN_PROGRESS');
    }
  });

  it('delivered (or escalated) and not closed: the photos can still be downloaded', () => {
    expect(blockerKindFor('DELIVERED')).toBe('PHOTOS_AVAILABLE');
    expect(blockerKindFor('QUALITY_ESCALATION')).toBe('PHOTOS_AVAILABLE');
  });

  it('a payment that may still be going through', () => {
    expect(blockerKindFor('ADVANCE_PENDING')).toBe('PAYMENT_IN_PROGRESS');
  });

  it('never an unpaid draft or quote, nor a booking that has ended', () => {
    const ended = BookingStatus.options.filter(
      (s) =>
        ![
          'DRAFT',
          'QUOTED',
          'ADVANCE_PENDING',
          'CONFIRMED',
          'DISPATCHING',
          'ASSIGNED',
          'EN_ROUTE',
          'CHECKED_IN',
          'IN_PROGRESS',
          'CHECKED_OUT',
          'UPLOADING',
          'PROCESSING',
          'QA',
          'BALANCE_PENDING',
          'DELIVERED',
          'QUALITY_ESCALATION',
          'UNSAFE_SITE',
        ].includes(s),
    );
    expect(ended.sort()).toEqual(
      [
        'ABANDONED',
        'ACCESS_DENIED',
        'CANCELLED_CLIENT',
        'CANCELLED_PRO',
        'CLOSED',
        'DATA_LOSS',
        'PRO_NO_SHOW',
      ].sort(),
    );
    for (const s of [...ended, 'DRAFT', 'QUOTED'] as const) expect(blockerKindFor(s)).toBeNull();
  });
});

describe('blockersFor', () => {
  const bookings = [
    { bookingId: A, reference: 'CLK-1004', status: 'DISPATCHING' as const },
    { bookingId: B, reference: 'CLK-1005', status: 'CLOSED' as const },
  ];

  it('names each booking in one plain sentence, money still being settled included', () => {
    const blockers = blockersFor(bookings, [B, B]);
    expect(blockers).toEqual([
      {
        kind: 'BOOKING_IN_PROGRESS',
        bookingId: A,
        reference: 'CLK-1004',
        message: expect.stringContaining('CLK-1004'),
      },
      {
        kind: 'MONEY_BEING_SETTLED',
        bookingId: B,
        reference: 'CLK-1005',
        message: expect.stringContaining('CLK-1005'),
      },
    ]);
    for (const b of blockers) expect(b.message).not.toMatch(/[A-Z]{4,}_/);
  });

  it('says nothing about a refund on a booking that is not the client’s', () => {
    expect(blockersFor(bookings, ['9b3f4e5d-6c7b-4a0f-9c8d-3e4f5a6b7c8d'])).toHaveLength(1);
  });

  it('an empty list when nothing is open', () => {
    expect(blockersFor([{ bookingId: B, reference: 'CLK-1005', status: 'CLOSED' }], [])).toEqual(
      [],
    );
  });
});

describe('the explanation', () => {
  it('lists what is erased and what the law makes us keep', () => {
    expect(DELETION_ERASES.join(' ')).toMatch(/name, phone number and email/);
    expect(DELETION_ERASES.join(' ')).toMatch(/signed out/);
    expect(DELETION_KEEPS.join(' ')).toMatch(/invoices/);
    expect(DELETION_KEEPS.join(' ')).toMatch(/8 years/);
  });

  it('says honestly what stays in the words the client wrote to us', () => {
    const keeps = DELETION_KEEPS.join(' ');
    expect(keeps).toMatch(/support tickets/i);
    expect(keeps).toMatch(/contact details/i);
    expect(keeps).toMatch(/quality complaints/i);
    expect(keeps).toMatch(/equipment/i);
    // Reviews and reports lose their words: no promise the copy cannot keep.
    expect(DELETION_ERASES.join(' ')).toMatch(/reports/i);
  });

  it('sums the unused, unexpired credit that is lost', () => {
    const now = new Date('2026-12-07T04:30:00Z');
    expect(
      forfeitedCredit(
        [
          { amountPaise: 50_000n, consumedPaise: 20_000n, expiresAt: new Date('2027-01-01') },
          { amountPaise: 10_000n, consumedPaise: 0n, expiresAt: new Date('2026-12-01') },
          { amountPaise: 5_000n, consumedPaise: 5_000n, expiresAt: new Date('2027-01-01') },
        ],
        now,
      ),
    ).toBe(30_000n);
  });
});
