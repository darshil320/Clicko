import type { DeliveryView } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import type { DeliveryBookingFacts } from '../bookings/bookings.types';
import { DELIVERY_CONFIG } from './delivery.config';
import type { DeliveryLinkRecord, DeliveryRecord } from './delivery.types';

/** Invariant 9: everything charged must be paid before a link opens. */
export const balanceDue = (
  f: Pick<DeliveryBookingFacts, 'totalPaise' | 'amountPaidPaise'>,
): bigint => (f.totalPaise > f.amountPaidPaise ? f.totalPaise - f.amountPaidPaise : 0n);

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toDeliveryView(
  facts: DeliveryBookingFacts,
  delivery: DeliveryRecord | null,
  links: readonly DeliveryLinkRecord[],
): DeliveryView {
  return {
    bookingId: facts.bookingId,
    bookingStatus: facts.status,
    qaStatus: delivery?.qaStatus ?? null,
    balanceDuePaise: fromPaiseBigint(balanceDue(facts)),
    counts: delivery ? { raw: delivery.raw, jpeg: delivery.jpeg, video: delivery.video } : null,
    releasedAt: iso(delivery?.releasedAt ?? null),
    rawExpiresAt: iso(delivery?.rawExpiresAt ?? null),
    jpegExpiresAt: iso(delivery?.jpegExpiresAt ?? null),
    links: links.map((l) => ({
      kind: l.kind,
      path: `${DELIVERY_CONFIG.publicPathPrefix}${l.publicToken}`,
      expiresAt: l.expiresAt.toISOString(),
      revoked: l.revokedAt !== null,
    })),
  };
}
