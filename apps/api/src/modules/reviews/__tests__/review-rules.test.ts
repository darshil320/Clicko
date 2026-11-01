import { describe, expect, it } from 'vitest';
import { cleanComment, isReviewable, toClientReview } from '../review-rules';
import type { ReviewRecord } from '../reviews.types';

const WRITTEN = new Date('2026-12-01T10:00:00.000Z');
const DAY = 86_400_000;

const record = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  id: '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f',
  bookingId: '8e0a4d2b-3c5f-4d9e-8a21-2b3c4d5e6f70',
  direction: 'CLIENT_TO_PRO',
  photographerId: '9f1b5e3c-4d6a-4e0f-9b32-3c4d5e6f7081',
  rating: 4,
  comment: 'Good',
  isPublished: true,
  moderatedBy: null,
  moderationNote: null,
  createdAt: WRITTEN,
  updatedAt: WRITTEN,
  ...over,
});

describe('review rules (ADR-0027 D4)', () => {
  it('a booking is reviewable once delivered, including after a quality issue or closing', () => {
    for (const s of ['DELIVERED', 'QUALITY_ESCALATION', 'CLOSED'] as const) {
      expect(isReviewable(s), s).toBe(true);
    }
    for (const s of [
      'CONFIRMED',
      'CHECKED_OUT',
      'QA',
      'BALANCE_PENDING',
      'CANCELLED_CLIENT',
    ] as const) {
      expect(isReviewable(s), s).toBe(false);
    }
  });

  it('publishes the comment without contact details; empty becomes null', () => {
    expect(cleanComment('Great! Call me on 98765 43210 or see ravi.photos.in')).toBe(
      'Great! Call me on or see',
    );
    expect(cleanComment('https://spam.example.com')).toBeNull();
    expect(cleanComment('   ')).toBeNull();
    expect(cleanComment(null)).toBeNull();
    expect(cleanComment(undefined)).toBeNull();
  });

  it('shows the client when the edit window closes, and that a hidden review cannot change', () => {
    expect(toClientReview(record(), new Date(WRITTEN.getTime() + DAY))).toMatchObject({
      rating: 4,
      comment: 'Good',
      isPublished: true,
      editableUntil: '2026-12-08T10:00:00.000Z',
      canEdit: true,
    });
    expect(toClientReview(record(), new Date(WRITTEN.getTime() + 8 * DAY)).canEdit).toBe(false);
    expect(
      toClientReview(record({ isPublished: false }), new Date(WRITTEN.getTime() + DAY)).canEdit,
    ).toBe(false);
  });
});
