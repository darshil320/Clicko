/**
 * Things that must not outlive a session (the booking draft with its venue address and keys,
 * the query cache). Features register a reset here; shared/ never imports features.
 * Runs on sign-out AND on expiry (a rejected refresh token), so a shared phone never hands
 * the next person someone else's checkout.
 */
const resets = new Set<() => void>();

export function onSessionEnd(reset: () => void): () => void {
  resets.add(reset);
  return () => {
    resets.delete(reset);
  };
}

export function runSessionEndResets(): void {
  for (const reset of resets) reset();
}
