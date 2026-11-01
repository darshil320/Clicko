import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';

/**
 * ADR-0027 D4 — reviews and UGC safety, as the client and Pro apps see them.
 *
 * - A client rates a delivered booking 1–5 with an optional comment: one review per booking,
 *   editable for 7 days from when it was first written. The rating feeds the photographer's
 *   metrics; a review hidden by staff stops counting.
 * - Clients and photographers report a review, a client or a photographer to the moderation desk.
 * - A client can block a photographer who worked on one of their bookings: dispatch never offers
 *   that client's bookings to them again.
 * - Public free text is length-limited, and links, emails and phone numbers are stripped from it
 *   on the server (`sanitisePublicText` in @clickco/utils).
 */

export const REVIEW_COMMENT_MAX_CHARS = 1_000;
/** A review can be edited for this long after it was first written. */
export const REVIEW_EDIT_WINDOW_DAYS = 7;
export const REPORT_NOTE_MAX_CHARS = 500;

const DAY_MS = 86_400_000;

/** The last moment a review written at `createdAt` can still be edited. */
export function reviewEditableUntil(createdAt: Date): Date {
  return new Date(createdAt.getTime() + REVIEW_EDIT_WINDOW_DAYS * DAY_MS);
}

/** Editable up to and including the instant the window closes. */
export function canEditReview(createdAt: Date, now: Date): boolean {
  return now.getTime() <= reviewEditableUntil(createdAt).getTime();
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export const ReviewRating = z.int().min(1, 'Choose 1 to 5 stars').max(5, 'Choose 1 to 5 stars');
export type ReviewRating = z.infer<typeof ReviewRating>;

/** POST /bookings/:id/review — writes the review, or edits it within the 7-day window. */
export const ReviewBody = z.object({
  rating: ReviewRating,
  comment: z
    .string()
    .trim()
    .max(REVIEW_COMMENT_MAX_CHARS, `Keep it under ${REVIEW_COMMENT_MAX_CHARS} characters`)
    .nullable()
    .optional(),
});
export type ReviewBody = z.infer<typeof ReviewBody>;

/** The client's own review of a booking (GET / POST /bookings/:id/review). */
export const ClientReview = z.object({
  id: Uuid,
  bookingId: Uuid,
  rating: ReviewRating,
  /** As published: links, emails and phone numbers removed. */
  comment: z.string().nullable(),
  /** false once Clickco has hidden it (it then no longer counts and cannot be edited). */
  isPublished: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  editableUntil: IsoDateTime,
  canEdit: z.boolean(),
});
export type ClientReview = z.infer<typeof ClientReview>;

// ── Reports ─────────────────────────────────────────────────────────────────

export const ReportTargetKind = z.enum(['REVIEW', 'USER', 'PHOTOGRAPHER']);
export type ReportTargetKind = z.infer<typeof ReportTargetKind>;

export const ReportReason = z.enum([
  'ABUSIVE',
  'HARASSMENT',
  'SPAM',
  'FALSE_INFORMATION',
  'PERSONAL_INFORMATION',
  'UNSAFE_BEHAVIOUR',
  'OTHER',
]);
export type ReportReason = z.infer<typeof ReportReason>;

export const ReportStatus = z.enum(['OPEN', 'ACTIONED', 'DISMISSED']);
export type ReportStatus = z.infer<typeof ReportStatus>;

export const ReporterKind = z.enum(['USER', 'PHOTOGRAPHER']);
export type ReporterKind = z.infer<typeof ReporterKind>;

/**
 * POST /reports (client) and POST /pro/reports (photographer). A REVIEW is named by its id; a
 * client or a photographer is reported about a booking the two of you shared (`bookingId`).
 * One open report per reporter and target.
 */
export const ReportBody = z
  .object({
    targetKind: ReportTargetKind,
    targetId: Uuid,
    bookingId: Uuid.optional(),
    reason: ReportReason,
    note: z
      .string()
      .trim()
      .max(REPORT_NOTE_MAX_CHARS, `Keep it under ${REPORT_NOTE_MAX_CHARS} characters`)
      .optional(),
  })
  .refine((b) => b.targetKind === 'REVIEW' || b.bookingId !== undefined, {
    message: 'Say which booking this is about',
    path: ['bookingId'],
  });
export type ReportBody = z.infer<typeof ReportBody>;

export const ReportReceipt = z.object({
  id: Uuid,
  status: ReportStatus,
  createdAt: IsoDateTime,
});
export type ReportReceipt = z.infer<typeof ReportReceipt>;

// ── Blocks ──────────────────────────────────────────────────────────────────

/** POST /me/blocks — idempotent: blocking twice is the same block. */
export const BlockPhotographerBody = z.object({ photographerId: Uuid });
export type BlockPhotographerBody = z.infer<typeof BlockPhotographerBody>;

export const BlockedPhotographer = z.object({
  photographerId: Uuid,
  name: z.string(),
  blockedAt: IsoDateTime,
});
export type BlockedPhotographer = z.infer<typeof BlockedPhotographer>;

export const BlockedPhotographerList = z.array(BlockedPhotographer);
export type BlockedPhotographerList = z.infer<typeof BlockedPhotographerList>;

/** POST /me/blocks/:photographerId/unblock — idempotent. */
export const UnblockResponse = z.object({ photographerId: Uuid, blocked: z.literal(false) });
export type UnblockResponse = z.infer<typeof UnblockResponse>;
