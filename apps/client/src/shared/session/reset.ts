/**
 * Things that must not outlive a session (the booking draft with its venue address and keys,
 * the query cache). Features register a reset here; shared/ never imports features.
 * Runs on sign-out AND on expiry (a rejected refresh token), so a shared phone never hands
 * the next person someone else's checkout.
 *
 * The reason lets a reset tell an ordinary sign-out from a deleted account (ADR-0030): a few
 * device-level choices (the shoot location) survive a sign-out but go with the account.
 */
export type SessionEndReason = 'signed-out' | 'account-deleted';

type Reset = (reason: SessionEndReason) => void;

const resets = new Set<Reset>();

export function onSessionEnd(reset: Reset): () => void {
  resets.add(reset);
  return () => {
    resets.delete(reset);
  };
}

export function runSessionEndResets(reason: SessionEndReason = 'signed-out'): void {
  for (const reset of resets) reset(reason);
}

/**
 * Everything a session leaves on the phone, one clear for each. The root layout fills it from the
 * features (shared/ never imports them), so adding a persisted store means adding it here, and the
 * compiler then asks for its clear.
 */
export interface LocalStateClears {
  /** The booking being put together: venue address, booking id, checkout keys. */
  readonly bookingDraft: () => void;
  /** Every Idempotency-Key ring: support and quality reports, cancellations, account deletion. */
  readonly keyRings: readonly (() => void)[];
  /** Server state cached in memory (bookings, money, tickets, the profile). */
  readonly queryCache: () => void;
  /** The chosen shoot pincode and area: a device choice kept across sign-outs. */
  readonly shootLocation: () => void;
}

/** The reset the root layout registers: per-session state always, device choices with the account. */
export function sessionEndReset(clears: LocalStateClears): Reset {
  return (reason) => {
    clears.bookingDraft();
    for (const clear of clears.keyRings) clear();
    clears.queryCache();
    if (reason === 'account-deleted') clears.shootLocation();
  };
}
