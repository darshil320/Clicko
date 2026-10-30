import { describe, expect, it } from 'vitest';
import {
  claimApprovalProblem,
  evidenceEntries,
  qualityAmountProblem,
  qualityReviewReason,
  ticketMessageEffect,
} from '../care-rules';

describe('quality outcomes → review items (ADR-0026 D6)', () => {
  it('raises a review item for money and reshoots, none for no action', () => {
    expect(qualityReviewReason('CREDIT')).toBe('QUALITY_CREDIT_DUE');
    expect(qualityReviewReason('PARTIAL_REFUND')).toBe('QUALITY_REFUND_DUE');
    expect(qualityReviewReason('RESHOOT')).toBe('QUALITY_RESHOOT_DUE');
    expect(qualityReviewReason('NO_ACTION')).toBeNull();
  });

  it('a credit never exceeds the booking total; a refund never exceeds what was paid', () => {
    const booking = { totalPaise: 1_000_000n, amountPaidPaise: 600_000n };
    expect(qualityAmountProblem('CREDIT', 1_000_000, booking)).toBeNull();
    expect(qualityAmountProblem('CREDIT', 1_000_001, booking)).toBe('CREDIT_ABOVE_TOTAL');
    expect(qualityAmountProblem('PARTIAL_REFUND', 600_000, booking)).toBeNull();
    expect(qualityAmountProblem('PARTIAL_REFUND', 600_001, booking)).toBe('REFUND_ABOVE_PAID');
    expect(qualityAmountProblem('RESHOOT', 0, booking)).toBeNull();
  });
});

describe('equipment claim approval (SA-01, T&C §8.2)', () => {
  const link = {
    kind: 'LINK' as const,
    url: 'https://drive.example/quote.pdf',
    label: 'Repair quote',
    addedAt: '2026-10-30T10:00:00.000Z',
    addedBy: null,
  };
  const note = {
    kind: 'NOTE' as const,
    text: 'Called the venue',
    addedAt: '2026-10-30T10:00:00.000Z',
    addedBy: null,
  };
  const claim = {
    status: 'UNDER_REVIEW' as const,
    claimedAmountPaise: 5_000_000n,
    capPaise: 20_000_000n,
    evidence: [link],
  };

  it('approves within the cap and the amount claimed, with documentary evidence', () => {
    expect(claimApprovalProblem(claim, 5_000_000)).toBeNull();
  });

  it('refuses more than was claimed, or more than the cap', () => {
    expect(claimApprovalProblem(claim, 5_000_001)).toBe('ABOVE_CLAIMED');
    expect(claimApprovalProblem({ ...claim, claimedAmountPaise: 30_000_000n }, 20_000_001)).toBe(
      'ABOVE_CAP',
    );
  });

  it('needs at least one evidence link — a note is not documentary evidence', () => {
    expect(claimApprovalProblem({ ...claim, evidence: [note] }, 100)).toBe('NO_EVIDENCE');
    expect(claimApprovalProblem({ ...claim, evidence: [] }, 100)).toBe('NO_EVIDENCE');
  });

  it('decides a claim once', () => {
    expect(claimApprovalProblem({ ...claim, status: 'APPROVED' }, 100)).toBe('ALREADY_DECIDED');
    expect(claimApprovalProblem({ ...claim, status: 'REJECTED' }, 100)).toBe('ALREADY_DECIDED');
    expect(claimApprovalProblem({ ...claim, status: 'OPEN' }, 100)).toBeNull();
  });

  it('builds the new trail entries (note first, then links), never touching the old ones', () => {
    const at = new Date('2026-10-30T11:00:00.000Z');
    const added = evidenceEntries(
      { note: 'Checked the invoice', links: [{ url: 'https://x.example/a', label: 'Invoice' }] },
      'staff-1',
      at,
    );
    expect(added).toEqual([
      { kind: 'NOTE', text: 'Checked the invoice', addedAt: at.toISOString(), addedBy: 'staff-1' },
      {
        kind: 'LINK',
        url: 'https://x.example/a',
        label: 'Invoice',
        addedAt: at.toISOString(),
        addedBy: 'staff-1',
      },
    ]);
  });
});

describe('ticket messages', () => {
  it('a reply acknowledges an unacknowledged ticket and waits on the customer', () => {
    expect(ticketMessageEffect('OPEN', 'REPLY', false)).toEqual({
      status: 'AWAITING_CUSTOMER',
      acknowledges: true,
      authorKind: 'STAFF',
      isInternal: false,
    });
    expect(ticketMessageEffect('IN_PROGRESS', 'REPLY', true)).toMatchObject({
      acknowledges: false,
    });
  });

  it('a note is internal and changes nothing', () => {
    expect(ticketMessageEffect('ACKNOWLEDGED', 'NOTE', true)).toEqual({
      status: 'ACKNOWLEDGED',
      acknowledges: false,
      authorKind: 'STAFF',
      isInternal: true,
    });
  });

  it('a logged customer message is the customer speaking', () => {
    expect(ticketMessageEffect('AWAITING_CUSTOMER', 'CUSTOMER', true)).toEqual({
      status: 'IN_PROGRESS',
      acknowledges: false,
      authorKind: 'CUSTOMER',
      isInternal: false,
    });
  });

  it('nothing is added to a resolved ticket', () => {
    expect(ticketMessageEffect('RESOLVED', 'REPLY', true)).toBeNull();
    expect(ticketMessageEffect('CLOSED', 'NOTE', true)).toBeNull();
  });
});
