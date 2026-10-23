/** Native has one JS context, so there is nothing to sync. Web: see sync.web.ts. */
export function syncSessionAcrossTabs(): () => void {
  return () => undefined;
}
