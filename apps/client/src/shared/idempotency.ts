/**
 * Idempotency-key bookkeeping for client writes (checkout, support tickets, quality issues). A
 * key belongs to a scope ("create", "pay:<bookingId>", "ticket") and the exact request it was
 * minted for (its fingerprint): a retry of the same request reuses the key — so a double tap or
 * a flaky network can never book, charge or raise a ticket twice — while any change to the
 * request gets a fresh key (the API answers 422 to a reused key with a different body).
 */
export interface MintedKey {
  readonly key: string;
  readonly fingerprint: string;
}

export type KeyRing = Readonly<Record<string, MintedKey>>;

export function claimKey(
  ring: KeyRing,
  scope: string,
  fingerprint: string,
  mint: () => string,
): { readonly key: string; readonly ring: KeyRing } {
  const existing = ring[scope];
  if (existing && existing.fingerprint === fingerprint) return { key: existing.key, ring };
  const key = mint();
  return { key, ring: { ...ring, [scope]: { key, fingerprint } } };
}

/** Stable JSON for fingerprints: object keys sorted, so property order never mints a new key. */
export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

/** The ring without one scope: after a success, the next request in that scope is a new intent. */
export function releaseKey(ring: KeyRing, scope: string): KeyRing {
  if (!(scope in ring)) return ring;
  return Object.fromEntries(Object.entries(ring).filter(([name]) => name !== scope));
}
