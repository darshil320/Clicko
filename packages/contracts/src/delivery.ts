import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';
import { BookingStatus, SlaKind } from './enums.js';
import { MoneyPaise } from './money.js';

/** ADR-0016 — delivery, QA and the SLA machine as the API exposes them. */

export const QaResult = z.enum(['PASS', 'FAIL']);
export type QaResult = z.infer<typeof QaResult>;

/** POST /dev/deliveries/:bookingId/qa (the S9 staff desk takes this over). */
export const QaDecisionBody = z.object({
  result: QaResult,
  note: z.string().trim().max(1_000).optional(),
});
export type QaDecisionBody = z.infer<typeof QaDecisionBody>;

export const QaStatus = z.enum(['PENDING', 'PASSED', 'FAILED']);
export type QaStatus = z.infer<typeof QaStatus>;

export const DeliveryLinkKind = z.enum(['RAW_PHOTO', 'JPEG_PHOTO', 'VIDEO']);
export type DeliveryLinkKind = z.infer<typeof DeliveryLinkKind>;

const KindCount = z.object({ files: z.int().min(0), bytes: z.int().min(0) });

export const DeliveryLinkView = z.object({
  kind: DeliveryLinkKind,
  /** Clickco's own URL path (`/d/<token>`); the provider link never leaves the server. */
  path: z.string(),
  expiresAt: IsoDateTime,
  revoked: z.boolean(),
});
export type DeliveryLinkView = z.infer<typeof DeliveryLinkView>;

/** GET /bookings/:id/delivery — what the client sees from QA onward. */
export const DeliveryView = z.object({
  bookingId: Uuid,
  bookingStatus: BookingStatus,
  qaStatus: QaStatus.nullable(),
  /** What must be paid before the links open (Invariant 9). */
  balanceDuePaise: MoneyPaise,
  counts: z.object({ raw: KindCount, jpeg: KindCount, video: KindCount }).nullable(),
  releasedAt: IsoDateTime.nullable(),
  rawExpiresAt: IsoDateTime.nullable(),
  jpegExpiresAt: IsoDateTime.nullable(),
  links: z.array(DeliveryLinkView),
});
export type DeliveryView = z.infer<typeof DeliveryView>;

export const SlaClockState = z.enum(['ARMED', 'MET', 'BREACHED', 'CANCELLED']);
export type SlaClockState = z.infer<typeof SlaClockState>;

export const SlaClockView = z.object({
  kind: SlaKind,
  state: SlaClockState,
  dueAt: IsoDateTime,
  /** due + time spent waiting for the client's payment (T&C §5.1). */
  effectiveDueAt: IsoDateTime,
  paused: z.boolean(),
  metAt: IsoDateTime.nullable(),
  breachedAt: IsoDateTime.nullable(),
});
export type SlaClockView = z.infer<typeof SlaClockView>;

export const SlaBreachView = z.object({
  kind: SlaKind,
  delayMinutes: z.int().min(0),
  band: z.enum(['H0_6', 'H6_24', 'H24_72', 'H72_PLUS']),
  remedyKind: z.enum(['CREDIT', 'PARTIAL_REFUND', 'FULL_REFUND']),
  remedyPaise: MoneyPaise,
  payoutDeductionBps: z.int().min(0).max(10_000),
  attributedTo: z.enum(['PHOTOGRAPHER', 'CLICKCO', 'CLIENT', 'FORCE_MAJEURE']),
  applied: z.boolean(),
});
export type SlaBreachView = z.infer<typeof SlaBreachView>;

/** GET /dev/bookings/:id/sla — the console's SLA timeline (development only). */
export const SlaTimelineView = z.object({
  bookingId: Uuid,
  clocks: z.array(SlaClockView),
  breaches: z.array(SlaBreachView),
});
export type SlaTimelineView = z.infer<typeof SlaTimelineView>;

/** GET /d/:token on the local adapter (development): what the link would open. */
export const LocalDeliveryLinkView = z.object({
  kind: DeliveryLinkKind,
  expiresAt: IsoDateTime,
  fileCount: z.int().min(0),
  note: z.string(),
});
export type LocalDeliveryLinkView = z.infer<typeof LocalDeliveryLinkView>;
