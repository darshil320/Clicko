import { describe, expect, it } from 'vitest';
import {
  AccountDeletionBlocker,
  ClientBookingMoney,
  ClientQualityIssueBody,
  ClientTicketBody,
  ClientTicketList,
  ClientTicketReply,
  ClientTicketReplyBody,
  ClientTicketThread,
  EndedEarlyJob,
  ProEarnings,
  ProPaidTransfer,
} from './index.js';

const UUID = '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f';
const AT = '2026-12-07T10:00:00+05:30';

describe('client care and money contracts (ADR-0027 D5)', () => {
  it('a ticket needs a category and 10–2,000 characters of message, trimmed', () => {
    expect(ClientTicketBody.parse({ category: 'BILLING', message: '  Charged twice!!  ' })).toEqual(
      { category: 'BILLING', message: 'Charged twice!!' },
    );
    expect(
      ClientTicketBody.safeParse({ category: 'BILLING', message: '   short   ' }).success,
    ).toBe(false);
    expect(
      ClientTicketBody.safeParse({ category: 'BILLING', message: 'x'.repeat(2_001) }).success,
    ).toBe(false);
    expect(
      ClientTicketBody.safeParse({ category: 'REFUND', message: 'Charged twice!!' }).success,
    ).toBe(false);
    expect(
      ClientTicketBody.safeParse({ bookingId: '../x', category: 'OTHER', message: 'Hello there!' })
        .success,
    ).toBe(false);
  });

  it('a quality complaint is 10–2,000 characters', () => {
    expect(ClientQualityIssueBody.safeParse({ complaint: 'Blurry photos' }).success).toBe(true);
    expect(ClientQualityIssueBody.safeParse({ complaint: 'bad' }).success).toBe(false);
  });

  it('refunds are only PROCESSING or REFUNDED to the client; money is whole paise', () => {
    const money = {
      bookingId: UUID,
      refunds: [
        { id: UUID, amountPaise: 100_000, status: 'REFUNDED', initiatedAt: AT, completedAt: AT },
      ],
      credits: [],
    };
    expect(ClientBookingMoney.safeParse(money).success).toBe(true);
    const requested = { ...money, refunds: [{ ...money.refunds[0], status: 'REQUESTED' }] };
    expect(ClientBookingMoney.safeParse(requested).success).toBe(false);
    const fractional = { ...money, refunds: [{ ...money.refunds[0], amountPaise: 10.5 }] };
    expect(ClientBookingMoney.safeParse(fractional).success).toBe(false);
  });

  it('a paid transfer carries only the last 4 characters of the UTR', () => {
    const transfer = {
      batchReference: 'PO20261214W',
      paidAt: AT,
      payoutCount: 1,
      grossPaise: 520_000,
      deductionsPaise: 0,
      tdsPaise: 0,
      netPaise: 520_000,
      utrLast4: '0077',
    };
    expect(ProPaidTransfer.safeParse(transfer).success).toBe(true);
    expect(ProPaidTransfer.safeParse({ ...transfer, utrLast4: null }).success).toBe(true);
    expect(ProPaidTransfer.safeParse({ ...transfer, utrLast4: 'HDFCN26121400077' }).success).toBe(
      false,
    );
    const earnings = {
      basis: 'EXPECTED',
      asOf: AT,
      todayPaise: 0,
      weekPaise: 0,
      monthPaise: 0,
      pendingPayoutPaise: 0,
      jobs: [],
    };
    expect(ProEarnings.safeParse(earnings).success).toBe(true);
    expect(ProEarnings.safeParse({ ...earnings, paidTransfers: [transfer] }).success).toBe(true);
  });

  it('a ticket reply is 1–2,000 characters, trimmed; the thread carries no internal flag', () => {
    expect(ClientTicketReplyBody.parse({ message: '  Still waiting  ' })).toEqual({
      message: 'Still waiting',
    });
    expect(ClientTicketReplyBody.safeParse({ message: '   ' }).success).toBe(false);
    expect(ClientTicketReplyBody.safeParse({ message: 'x'.repeat(2_001) }).success).toBe(false);
    const thread = {
      id: UUID,
      reference: 'TKT-1042',
      category: 'BILLING',
      subject: 'Billing',
      bookingId: null,
      status: 'IN_PROGRESS',
      receivedAt: AT,
      ackDueAt: AT,
      acknowledgedAt: AT,
      resolveDueAt: AT,
      resolvedAt: null,
      resolutionSummary: null,
      messages: [
        { id: UUID, authorKind: 'CUSTOMER', body: 'Charged twice.', createdAt: AT },
        { id: UUID, authorKind: 'STAFF', body: 'Refund on its way.', createdAt: AT },
      ],
    };
    const parsed = ClientTicketThread.parse({
      ...thread,
      messages: [{ ...thread.messages[0], isInternal: false, authorId: UUID }],
    });
    // Unknown keys are stripped: an internal flag or a staff id never reaches the app.
    expect(parsed.messages[0]).toEqual(thread.messages[0]);
    expect(ClientTicketThread.safeParse(thread).success).toBe(true);
    // The list carries no conversation: a ticket's thread is read one at a time.
    const listed = ClientTicketList.parse([thread]);
    expect(listed[0]).not.toHaveProperty('messages');
    const reply = { ticketId: UUID, status: 'IN_PROGRESS', message: thread.messages[0] };
    expect(ClientTicketReply.parse(reply)).toEqual(reply);
  });

  it('a job that ended before a check-out lists its payout basis, status and amount', () => {
    const job = {
      bookingId: UUID,
      bookingReference: 'CLK-1004',
      categoryCode: 'FOOD',
      scheduledStart: AT,
      endedAt: AT,
      payoutBasis: 'CLIENT_CANCELLED',
      payoutStatus: 'DUE',
      totalPayoutPaise: 125_000,
    };
    expect(EndedEarlyJob.safeParse(job).success).toBe(true);
    expect(EndedEarlyJob.safeParse({ ...job, payoutBasis: 'DELIVERED' }).success).toBe(false);
    expect(EndedEarlyJob.safeParse({ ...job, totalPayoutPaise: 1.5 }).success).toBe(false);
    const earnings = {
      basis: 'EXPECTED',
      asOf: AT,
      todayPaise: 0,
      weekPaise: 0,
      monthPaise: 0,
      pendingPayoutPaise: 0,
      jobs: [],
    };
    expect(ProEarnings.parse({ ...earnings, endedEarlyJobs: [job] }).endedEarlyJobs).toEqual([job]);
    expect(ProEarnings.parse(earnings).endedEarlyJobs).toBeUndefined();
  });

  it('an account deletion blocker names its booking and when it is scheduled', () => {
    const blocker = {
      kind: 'BOOKING_IN_PROGRESS',
      bookingId: UUID,
      reference: 'CLK-1004',
      scheduledStart: AT,
      message: 'CLK-1004 is paid and not finished yet.',
    };
    expect(AccountDeletionBlocker.safeParse(blocker).success).toBe(true);
    const { scheduledStart: _, ...withoutDate } = blocker;
    expect(AccountDeletionBlocker.safeParse(withoutDate).success).toBe(false);
  });
});
