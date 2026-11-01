import {
  type BookingStatus,
  type ClientReview,
  canEditReview,
  REVIEW_COMMENT_MAX_CHARS,
  reviewEditableUntil,
} from '@clickco/contracts';
import { sanitisePublicText } from '@clickco/utils';
import type { ReviewRecord } from './reviews.types';

/**
 * ADR-0027 D4, as pure functions. A booking is reviewable once delivered — and stays so after a
 * quality issue or closing (both only follow DELIVERED, ADR-0011).
 */
const REVIEWABLE: readonly BookingStatus[] = ['DELIVERED', 'QUALITY_ESCALATION', 'CLOSED'];

export const isReviewable = (status: BookingStatus): boolean => REVIEWABLE.includes(status);

/** The comment as it will be published: no links, emails or phone numbers; '' → null. */
export function cleanComment(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = sanitisePublicText(raw, REVIEW_COMMENT_MAX_CHARS);
  return text === '' ? null : text;
}

/** The client's view: when editing closes, and whether it is still possible (never once hidden). */
export function toClientReview(r: ReviewRecord, now: Date): ClientReview {
  return {
    id: r.id,
    bookingId: r.bookingId,
    rating: r.rating,
    comment: r.comment,
    isPublished: r.isPublished,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    editableUntil: reviewEditableUntil(r.createdAt).toISOString(),
    canEdit: r.isPublished && canEditReview(r.createdAt, now),
  };
}
