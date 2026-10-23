/**
 * ADR-0013 D8 — reading extension state from append-only assignment events. Requests and their
 * resolutions are written under the booking lock with at most one open request, so each
 * resolution answers the latest open request. Expiry is evaluated lazily against `now`.
 */
import type { ExtensionStatus } from '@clickco/contracts';
import { extensionExpiresAt } from './timing';

export const EXTENSION_DECLINE_REASON = {
  CLIENT: 'DECLINED_BY_CLIENT',
  EXPIRED: 'EXPIRED',
  CONFLICT: 'CALENDAR_CONFLICT',
  SHOOT_ENDED: 'SHOOT_ENDED',
} as const;
export type ExtensionDeclineReason =
  (typeof EXTENSION_DECLINE_REASON)[keyof typeof EXTENSION_DECLINE_REASON];

export interface ExtensionEventInput {
  readonly id: string;
  readonly kind: string;
  readonly occurredAt: Date;
  readonly note: string | null;
  readonly amountPaise: bigint | null;
}

export interface ExtensionRequestState {
  readonly eventId: string;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  readonly amountPaise: bigint;
  readonly status: ExtensionStatus;
  readonly resolvedAt: Date | null;
}

export interface ExtensionLedger {
  readonly requests: readonly ExtensionRequestState[];
  /** Unresolved and not yet expired: the one the client may approve. */
  readonly open: ExtensionRequestState | null;
  /** Unresolved at all (possibly lapsed, awaiting its EXPIRED record). */
  readonly unresolved: ExtensionRequestState | null;
  readonly approvedCount: number;
}

const resolved = (
  r: ExtensionRequestState,
  status: ExtensionStatus,
  at: Date,
): ExtensionRequestState => ({ ...r, status, resolvedAt: at });

export function extensionLedger(
  events: readonly ExtensionEventInput[],
  now: Date,
): ExtensionLedger {
  const requests: ExtensionRequestState[] = [];
  let openIndex: number | null = null;
  for (const e of events) {
    if (e.kind === 'EXTENSION_REQUESTED') {
      requests.push({
        eventId: e.id,
        requestedAt: e.occurredAt,
        expiresAt: extensionExpiresAt(e.occurredAt),
        amountPaise: e.amountPaise ?? 0n,
        status: 'PENDING',
        resolvedAt: null,
      });
      openIndex = requests.length - 1;
    } else if (
      (e.kind === 'EXTENSION_APPROVED' || e.kind === 'EXTENSION_DECLINED') &&
      openIndex !== null
    ) {
      const current = requests[openIndex];
      if (current) {
        const status: ExtensionStatus =
          e.kind === 'EXTENSION_APPROVED'
            ? 'APPROVED'
            : e.note === EXTENSION_DECLINE_REASON.EXPIRED
              ? 'EXPIRED'
              : 'DECLINED';
        requests[openIndex] = resolved(current, status, e.occurredAt);
      }
      openIndex = null;
    }
  }
  const unresolved = openIndex === null ? null : (requests[openIndex] ?? null);
  const lapsed = unresolved !== null && now >= unresolved.expiresAt;
  const shown = requests.map((r) =>
    r === unresolved && lapsed ? { ...r, status: 'EXPIRED' as const } : r,
  );
  return {
    requests: shown,
    open: unresolved && !lapsed ? unresolved : null,
    unresolved,
    approvedCount: shown.filter((r) => r.status === 'APPROVED').length,
  };
}
