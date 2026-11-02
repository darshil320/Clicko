/**
 * Is the app offline? Pure transitions over what the app has just seen, so the rules are
 * unit-tested. There is no device network API in the apps (no NetInfo): like the Pro offline
 * queue (ADR-0024 D5), "offline" means a request got no answer at all, and any answer — even an
 * HTTP error — means the server is reachable again. On web the browser's own online flag
 * (TanStack's onlineManager) counts too.
 */

export type NetworkSignal =
  /** The server answered (success or an HTTP error). */
  | { readonly type: 'answered' }
  /** A request got no answer: offline, DNS, timeout. */
  | { readonly type: 'unreachable' }
  /** The platform's own online flag changed (web only; native always reports online). */
  | { readonly type: 'device'; readonly online: boolean };

export interface NetworkState {
  /** The last request got no answer and nothing has answered since. */
  readonly unreachable: boolean;
  /** The platform says there is no network. */
  readonly deviceOffline: boolean;
}

export const ONLINE: NetworkState = { unreachable: false, deviceOffline: false };

const ANSWERED: NetworkSignal = { type: 'answered' };
const UNREACHABLE: NetworkSignal = { type: 'unreachable' };

export const isOfflineState = (state: NetworkState): boolean =>
  state.unreachable || state.deviceOffline;

/** A failed request as a signal: no answer is "unreachable", any answer is "answered". */
export function signalFromError(
  error: unknown,
  isOffline: (error: unknown) => boolean,
): NetworkSignal {
  return isOffline(error) ? UNREACHABLE : ANSWERED;
}

/** The parts of a TanStack query or mutation cache action this reads. */
export interface CacheActionLike {
  readonly type: string;
  readonly error?: unknown;
  /** setQueryData: a local write, which says nothing about the network. */
  readonly manual?: boolean;
}

/** A query/mutation cache action as a signal; null when it says nothing about the network. */
export function signalFromAction(
  action: CacheActionLike,
  isOffline: (error: unknown) => boolean,
): NetworkSignal | null {
  switch (action.type) {
    case 'success':
      return action.manual === true ? null : ANSWERED;
    case 'failed':
    case 'error':
      return signalFromError(action.error, isOffline);
    default:
      return null;
  }
}

/** The next state. Returns the same object when nothing changes, so stores can skip a render. */
export function nextNetworkState(state: NetworkState, signal: NetworkSignal): NetworkState {
  switch (signal.type) {
    case 'answered':
      return state.unreachable ? { ...state, unreachable: false } : state;
    case 'unreachable':
      return state.unreachable ? state : { ...state, unreachable: true };
    case 'device': {
      const deviceOffline = !signal.online;
      return state.deviceOffline === deviceOffline ? state : { ...state, deviceOffline };
    }
  }
}
