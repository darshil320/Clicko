import { pickScreenState, type QueryLike, type ScreenState } from '@clickco/ui/state';
import { isOffline, userMessage } from './errors';

export type { ScreenState } from '@clickco/ui/state';

/**
 * The state a screen or section shows for a query: loading, offline, error (with a human
 * sentence), empty or ready (stale when a refresh failed). Render it with @clickco/ui's
 * StateView, or switch on `kind`. `isEmpty` defaults to null or an empty list.
 */
export function screenState<T>(
  query: QueryLike<T>,
  isEmpty?: (data: T) => boolean,
): ScreenState<T> {
  return pickScreenState(query, { isOffline, describe: userMessage, isEmpty });
}
