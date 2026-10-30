import { describe, expect, it } from 'vitest';
import {
  ACK_DUE_SOON_MS,
  AdminApproveClaimBody,
  AdminAssessClaimBody,
  AdminCreateTicketBody,
  AdminOpenQualityBody,
  AdminResolveQualityBody,
  BookingReferenceInput,
  deadlineState,
  EQUIPMENT_CLAIM_CAP_PAISE,
  RESOLVE_DUE_SOON_MS,
  ticketClock,
  ticketDeadlines,
  ticketStatusAfter,
} from './admin-care.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RECEIVED = new Date('2026-10-30T04:30:00.000Z');

describe('grievance deadlines (SA-02, T&C §12)', () => {
  it('acknowledge within 48 hours, resolve within 30 days of receipt', () => {
    const d = ticketDeadlines(RECEIVED);
    expect(d.ackDueAt.toISOString()).toBe('2026-11-01T04:30:00.000Z');
    expect(d.resolveDueAt.toISOString()).toBe('2026-11-29T04:30:00.000Z');
  });

  it('is on track, then amber when close, then red when overdue', () => {
    const due = new Date(RECEIVED.getTime() + 48 * HOUR);
    const at = (h: number) => RECEIVED.getTime() + h * HOUR;
    expect(deadlineState(due, null, at(1), ACK_DUE_SOON_MS)).toBe('ON_TRACK');
    expect(deadlineState(due, null, at(35.99), ACK_DUE_SOON_MS)).toBe('ON_TRACK');
    expect(deadlineState(due, null, at(36), ACK_DUE_SOON_MS)).toBe('DUE_SOON');
    expect(deadlineState(due, null, at(48), ACK_DUE_SOON_MS)).toBe('DUE_SOON');
    expect(deadlineState(due, null, at(48) + 1, ACK_DUE_SOON_MS)).toBe('OVERDUE');
  });

  it('is met once done on time, met late after', () => {
    const due = '2026-11-01T04:30:00.000Z';
    expect(deadlineState(due, '2026-11-01T04:30:00.000Z', Date.now(), ACK_DUE_SOON_MS)).toBe('MET');
    expect(deadlineState(due, '2026-11-01T04:30:00.001Z', Date.now(), ACK_DUE_SOON_MS)).toBe(
      'MET_LATE',
    );
  });

  it('watches acknowledgement first, then resolution', () => {
    const d = ticketDeadlines(RECEIVED);
    const t = {
      ackDueAt: d.ackDueAt.toISOString(),
      acknowledgedAt: null,
      resolveDueAt: d.resolveDueAt.toISOString(),
      resolvedAt: null,
    };
    expect(ticketClock(t, RECEIVED.getTime() + 47 * HOUR)).toEqual({
      kind: 'ACK',
      dueAt: t.ackDueAt,
      state: 'DUE_SOON',
    });
    const acked = { ...t, acknowledgedAt: new Date(RECEIVED.getTime() + HOUR).toISOString() };
    expect(ticketClock(acked, RECEIVED.getTime() + 28 * DAY).state).toBe('DUE_SOON');
    expect(ticketClock(acked, RECEIVED.getTime() + 20 * DAY).state).toBe('ON_TRACK');
    expect(ticketClock(acked, RECEIVED.getTime() + 31 * DAY).state).toBe('OVERDUE');
    expect(RESOLVE_DUE_SOON_MS).toBe(3 * DAY);
  });

  it('a resolved ticket that was never acknowledged is judged on resolution', () => {
    const d = ticketDeadlines(RECEIVED);
    const t = {
      ackDueAt: d.ackDueAt.toISOString(),
      acknowledgedAt: null,
      resolveDueAt: d.resolveDueAt.toISOString(),
      resolvedAt: new Date(RECEIVED.getTime() + DAY).toISOString(),
    };
    expect(ticketClock(t, RECEIVED.getTime() + 40 * DAY)).toMatchObject({
      kind: 'RESOLVE',
      state: 'MET',
    });
  });
});

describe('ticket status transitions', () => {
  it('acknowledges an open ticket only', () => {
    expect(ticketStatusAfter('OPEN', 'ACKNOWLEDGE')).toBe('ACKNOWLEDGED');
    expect(ticketStatusAfter('IN_PROGRESS', 'ACKNOWLEDGE')).toBeNull();
  });

  it('a reply waits on the customer; a note changes nothing; the customer reopens', () => {
    expect(ticketStatusAfter('OPEN', 'REPLY')).toBe('AWAITING_CUSTOMER');
    expect(ticketStatusAfter('ACKNOWLEDGED', 'NOTE')).toBe('ACKNOWLEDGED');
    expect(ticketStatusAfter('AWAITING_CUSTOMER', 'LOG_CUSTOMER')).toBe('IN_PROGRESS');
    expect(ticketStatusAfter('OPEN', 'LOG_CUSTOMER')).toBe('OPEN');
  });

  it('resolves anything still open; nothing moves a resolved or closed ticket', () => {
    expect(ticketStatusAfter('AWAITING_CUSTOMER', 'RESOLVE')).toBe('RESOLVED');
    for (const action of ['ACKNOWLEDGE', 'REPLY', 'NOTE', 'LOG_CUSTOMER', 'RESOLVE'] as const) {
      expect(ticketStatusAfter('RESOLVED', action)).toBeNull();
      expect(ticketStatusAfter('CLOSED', action)).toBeNull();
    }
  });
});

describe('care bodies', () => {
  it('normalises a booking reference', () => {
    expect(BookingReferenceInput.parse(' clk-1004 ')).toBe('CLK-1004');
    expect(BookingReferenceInput.safeParse('1004').success).toBe(false);
  });

  it('opens a quality issue with a real complaint', () => {
    expect(
      AdminOpenQualityBody.safeParse({ bookingReference: 'CLK-1004', complaint: 'blurry' }).success,
    ).toBe(false);
    expect(
      AdminOpenQualityBody.safeParse({
        bookingReference: 'CLK-1004',
        complaint: 'Half the photos are out of focus',
      }).success,
    ).toBe(true);
  });

  it('a money outcome needs an amount; the others must not carry one', () => {
    const note = 'Agreed with the client';
    expect(AdminResolveQualityBody.safeParse({ outcome: 'CREDIT', note }).success).toBe(false);
    expect(
      AdminResolveQualityBody.safeParse({ outcome: 'CREDIT', amountPaise: 250_000, note }).success,
    ).toBe(true);
    expect(
      AdminResolveQualityBody.safeParse({ outcome: 'PARTIAL_REFUND', amountPaise: 0, note })
        .success,
    ).toBe(false);
    expect(
      AdminResolveQualityBody.safeParse({ outcome: 'NO_ACTION', amountPaise: 100, note }).success,
    ).toBe(false);
    expect(AdminResolveQualityBody.safeParse({ outcome: 'RESHOOT', note }).success).toBe(true);
  });

  it('a ticket needs a way to reach the customer', () => {
    const base = {
      raisedBy: 'USER',
      contactName: 'Priya Sharma',
      category: 'GRIEVANCE',
      subject: 'Photos missing',
      message: 'I only received 20 photos',
    };
    expect(AdminCreateTicketBody.safeParse(base).success).toBe(false);
    expect(
      AdminCreateTicketBody.safeParse({ ...base, contactPhone: '+919800000001' }).success,
    ).toBe(true);
    expect(
      AdminCreateTicketBody.safeParse({ ...base, contactEmail: 'priya@example.com' }).success,
    ).toBe(true);
  });

  it('a claim approval stays within the ₹2,00,000 cap', () => {
    expect(EQUIPMENT_CLAIM_CAP_PAISE).toBe(20_000_000);
    expect(
      AdminApproveClaimBody.safeParse({ amountPaise: 20_000_000, note: 'Repair quote' }).success,
    ).toBe(true);
    expect(
      AdminApproveClaimBody.safeParse({ amountPaise: 20_000_001, note: 'Repair quote' }).success,
    ).toBe(false);
  });

  it('an assessment adds a note or an https link', () => {
    expect(AdminAssessClaimBody.safeParse({}).success).toBe(false);
    expect(AdminAssessClaimBody.safeParse({ note: 'Called the venue' }).success).toBe(true);
    expect(
      AdminAssessClaimBody.safeParse({
        links: [{ url: 'https://drive.example/quote.pdf', label: 'Repair quote' }],
      }).success,
    ).toBe(true);
    expect(
      AdminAssessClaimBody.safeParse({ links: [{ url: 'http://x.example/q', label: 'Quote' }] })
        .success,
    ).toBe(false);
  });
});
