import { describe, expect, it } from 'vitest';
import { ADMIN_DESK_ROLES, ADMIN_DESKS } from './admin-desks.js';
import {
  AdminModerationDecisionBody,
  AdminModerationQuery,
  AdminModerationReported,
  reportStatusAfter,
} from './admin-moderation.js';
import {
  canEditReview,
  REVIEW_COMMENT_MAX_CHARS,
  ReportBody,
  ReviewBody,
  reviewEditableUntil,
} from './reviews.js';

const ID = '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f';
const BOOKING = '8e0a4d2b-3c5f-4d9e-8a21-2b3c4d5e6f70';

describe('ReviewBody (ADR-0027 D4)', () => {
  it('takes 1–5 whole stars and an optional comment', () => {
    expect(ReviewBody.parse({ rating: 5 })).toEqual({ rating: 5 });
    expect(ReviewBody.parse({ rating: 1, comment: '  Lovely shoot  ' })).toEqual({
      rating: 1,
      comment: 'Lovely shoot',
    });
    expect(ReviewBody.parse({ rating: 4, comment: null })).toEqual({ rating: 4, comment: null });
    for (const rating of [0, 6, 4.5, '5']) {
      expect(ReviewBody.safeParse({ rating }).success, String(rating)).toBe(false);
    }
  });

  it('limits the comment length', () => {
    const max = 'a'.repeat(REVIEW_COMMENT_MAX_CHARS);
    expect(ReviewBody.safeParse({ rating: 5, comment: max }).success).toBe(true);
    expect(ReviewBody.safeParse({ rating: 5, comment: `${max}a` }).success).toBe(false);
  });
});

describe('the 7-day edit window', () => {
  const written = new Date('2026-12-01T10:00:00.000Z');

  it('closes exactly 7 days after the review was first written', () => {
    expect(reviewEditableUntil(written).toISOString()).toBe('2026-12-08T10:00:00.000Z');
    expect(canEditReview(written, new Date('2026-12-08T10:00:00.000Z'))).toBe(true);
    expect(canEditReview(written, new Date('2026-12-08T10:00:00.001Z'))).toBe(false);
  });
});

describe('ReportBody', () => {
  it('names a review by its id alone', () => {
    expect(
      ReportBody.safeParse({ targetKind: 'REVIEW', targetId: ID, reason: 'ABUSIVE' }).success,
    ).toBe(true);
  });

  it('needs the shared booking for a client or a photographer', () => {
    for (const targetKind of ['USER', 'PHOTOGRAPHER'] as const) {
      const without = ReportBody.safeParse({ targetKind, targetId: ID, reason: 'HARASSMENT' });
      expect(without.success).toBe(false);
      expect(without.error?.issues[0]?.path).toEqual(['bookingId']);
      expect(
        ReportBody.safeParse({ targetKind, targetId: ID, bookingId: BOOKING, reason: 'SPAM' })
          .success,
      ).toBe(true);
    }
  });

  it('limits the note and refuses unknown reasons', () => {
    const base = { targetKind: 'REVIEW', targetId: ID, reason: 'OTHER' };
    expect(ReportBody.safeParse({ ...base, note: 'x'.repeat(500) }).success).toBe(true);
    expect(ReportBody.safeParse({ ...base, note: 'x'.repeat(501) }).success).toBe(false);
    expect(ReportBody.safeParse({ ...base, reason: 'BORED' }).success).toBe(false);
  });
});

describe('the moderation desk', () => {
  it('is opened by the Quality Manager, support and city managers', () => {
    expect(ADMIN_DESKS).toContain('moderation');
    expect([...ADMIN_DESK_ROLES.moderation].sort()).toEqual([
      'CITY_MANAGER',
      'QUALITY_MANAGER',
      'SUPPORT',
    ]);
  });

  it('HIDE and WARN action a report; KEEP and DISMISS dismiss it', () => {
    expect(reportStatusAfter('HIDE')).toBe('ACTIONED');
    expect(reportStatusAfter('WARN')).toBe('ACTIONED');
    expect(reportStatusAfter('KEEP')).toBe('DISMISSED');
    expect(reportStatusAfter('DISMISS')).toBe('DISMISSED');
  });

  it('keeps what a review said when it was reported', () => {
    expect(AdminModerationReported.parse({ rating: 2, comment: null })).toEqual({
      rating: 2,
      comment: null,
    });
    expect(AdminModerationReported.safeParse({ rating: 0, comment: 'x' }).success).toBe(false);
  });

  it('needs a note with every decision and lists OPEN reports by default', () => {
    expect(AdminModerationDecisionBody.safeParse({ decision: 'HIDE', note: ' ' }).success).toBe(
      false,
    );
    expect(AdminModerationDecisionBody.parse({ decision: 'KEEP', note: ' Fair review ' })).toEqual({
      decision: 'KEEP',
      note: 'Fair review',
    });
    expect(AdminModerationQuery.parse({})).toEqual({ status: 'OPEN', limit: 50 });
  });
});
