import { describe, expect, it } from 'vitest';
import {
  isOfflineState,
  type NetworkState,
  nextNetworkState,
  ONLINE,
  signalFromAction,
  signalFromError,
} from './network-status';
import {
  isEmptyData,
  PAUSED_MESSAGE,
  pickScreenState,
  type QueryLike,
  type ScreenStateOptions,
} from './screen-state';
import { bannerContent, errorBody, STATE_COPY } from './states.copy';
import { TILE_TONE } from './tile.styles';

/** Stands in for the apps' ApiError of kind NETWORK. */
class NoAnswer extends Error {}
const offlineError = new NoAnswer('fetch failed');
const serverError = new Error('500');

const options: ScreenStateOptions<readonly string[]> = {
  isOffline: (error) => error instanceof NoAnswer,
  describe: (error) => (error instanceof NoAnswer ? 'You seem to be offline.' : 'Try again soon.'),
};

const query = (over: Partial<QueryLike<readonly string[]>>): QueryLike<readonly string[]> => ({
  data: undefined,
  error: null,
  status: 'pending',
  fetchStatus: 'fetching',
  ...over,
});

describe('pickScreenState', () => {
  it('is loading while the first fetch runs', () => {
    expect(pickScreenState(query({}), options)).toEqual({ kind: 'loading' });
  });

  it('ends a failed first load in offline or error, never an endless skeleton', () => {
    expect(
      pickScreenState(
        query({ status: 'error', error: offlineError, fetchStatus: 'idle' }),
        options,
      ),
    ).toEqual({ kind: 'offline', message: 'You seem to be offline.', retrying: false });
    expect(
      pickScreenState(query({ status: 'error', error: serverError, fetchStatus: 'idle' }), options),
    ).toEqual({ kind: 'error', message: 'Try again soon.', retrying: false });
  });

  it('marks a retry in flight so the button can show it', () => {
    const state = pickScreenState(
      query({ status: 'error', error: serverError, fetchStatus: 'fetching' }),
      options,
    );
    expect(state).toMatchObject({ kind: 'error', retrying: true });
  });

  it('treats a query paused by the device going offline as offline', () => {
    expect(pickScreenState(query({ fetchStatus: 'paused' }), options)).toEqual({
      kind: 'offline',
      message: PAUSED_MESSAGE,
      retrying: false,
    });
  });

  it('shows loaded data as ready, or empty with the default rule', () => {
    expect(
      pickScreenState(query({ data: ['a'], status: 'success', fetchStatus: 'idle' }), options),
    ).toEqual({ kind: 'ready', data: ['a'], stale: null });
    expect(
      pickScreenState(query({ data: [], status: 'success', fetchStatus: 'idle' }), options),
    ).toEqual({ kind: 'empty', data: [], stale: null });
  });

  it('keeps data on screen when a refresh fails, marked stale with the cause', () => {
    expect(
      pickScreenState(
        query({ data: ['a'], status: 'error', error: offlineError, fetchStatus: 'idle' }),
        options,
      ),
    ).toEqual({
      kind: 'ready',
      data: ['a'],
      stale: { kind: 'offline', message: 'You seem to be offline.' },
    });
    expect(
      pickScreenState(
        query({ data: [], status: 'error', error: serverError, fetchStatus: 'idle' }),
        options,
      ),
    ).toMatchObject({ kind: 'empty', stale: { kind: 'error' } });
    expect(
      pickScreenState(query({ data: ['a'], status: 'success', fetchStatus: 'paused' }), options),
    ).toMatchObject({ kind: 'ready', stale: { kind: 'offline', message: PAUSED_MESSAGE } });
  });

  it('takes a screen-specific empty rule', () => {
    const custom = { ...options, isEmpty: (data: readonly string[]) => !data.includes('live') };
    expect(
      pickScreenState(query({ data: ['old'], status: 'success', fetchStatus: 'idle' }), custom)
        .kind,
    ).toBe('empty');
    expect(
      pickScreenState(query({ data: ['live'], status: 'success', fetchStatus: 'idle' }), custom)
        .kind,
    ).toBe('ready');
  });

  it('counts null and empty lists as empty, never an object with content', () => {
    expect(isEmptyData(null)).toBe(true);
    expect(isEmptyData([])).toBe(true);
    expect(isEmptyData(['x'])).toBe(false);
    expect(isEmptyData({ jobs: [] })).toBe(false);
    expect(isEmptyData(0)).toBe(false);
  });
});

describe('network status', () => {
  const isOffline = (error: unknown) => error instanceof NoAnswer;

  it('goes offline when a request gets no answer and back when anything answers', () => {
    const down = nextNetworkState(ONLINE, { type: 'unreachable' });
    expect(isOfflineState(down)).toBe(true);
    expect(isOfflineState(nextNetworkState(down, { type: 'answered' }))).toBe(false);
  });

  it('follows the device flag separately from request outcomes', () => {
    const deviceOff = nextNetworkState(ONLINE, { type: 'device', online: false });
    expect(isOfflineState(deviceOff)).toBe(true);
    // An answer does not override the platform saying there is no network.
    expect(isOfflineState(nextNetworkState(deviceOff, { type: 'answered' }))).toBe(true);
    expect(isOfflineState(nextNetworkState(deviceOff, { type: 'device', online: true }))).toBe(
      false,
    );
  });

  it('returns the same object when nothing changes, and never mutates', () => {
    const before: NetworkState = { ...ONLINE };
    expect(nextNetworkState(before, { type: 'answered' })).toBe(before);
    expect(nextNetworkState(before, { type: 'device', online: true })).toBe(before);
    nextNetworkState(before, { type: 'unreachable' });
    expect(before).toEqual(ONLINE);
  });

  it('reads an HTTP error as the server answering, a missing answer as unreachable', () => {
    expect(signalFromError(serverError, isOffline)).toEqual({ type: 'answered' });
    expect(signalFromError(offlineError, isOffline)).toEqual({ type: 'unreachable' });
  });

  it('maps query and mutation cache actions, ignoring local writes and bookkeeping', () => {
    expect(signalFromAction({ type: 'success' }, isOffline)).toEqual({ type: 'answered' });
    expect(signalFromAction({ type: 'success', manual: true }, isOffline)).toBeNull();
    expect(signalFromAction({ type: 'failed', error: offlineError }, isOffline)).toEqual({
      type: 'unreachable',
    });
    expect(signalFromAction({ type: 'error', error: serverError }, isOffline)).toEqual({
      type: 'answered',
    });
    for (const type of ['fetch', 'pause', 'continue', 'invalidate', 'pending', 'setState']) {
      expect(signalFromAction({ type }, isOffline)).toBeNull();
    }
  });
});

describe('state copy', () => {
  it('gives an error block a reason even when the screen has none', () => {
    expect(errorBody(true)).toBe(STATE_COPY.offlineBody);
    expect(errorBody(false)).toBe(STATE_COPY.errorBody);
    expect(errorBody(false, '   ')).toBe(STATE_COPY.errorBody);
    expect(errorBody(false, 'This quote has expired.')).toBe('This quote has expired.');
  });

  it('keeps banner words overridable and their tile tones real', () => {
    expect(bannerContent('offline').title).toBe("You're offline");
    expect(bannerContent('stale', { body: 'Showing the job as of 4:30 pm.' })).toEqual({
      title: STATE_COPY.staleTitle,
      body: 'Showing the job as of 4:30 pm.',
      tone: 'neutral',
    });
    for (const kind of ['offline', 'stale'] as const) {
      expect(TILE_TONE[bannerContent(kind).tone]).toBeDefined();
    }
  });

  it('keeps every line short, plain and free of codes', () => {
    for (const line of Object.values(STATE_COPY)) {
      expect(line.length).toBeLessThanOrEqual(60);
      expect(line).not.toMatch(/[A-Z]{3,}_|error code|exception/i);
    }
    expect(PAUSED_MESSAGE).not.toMatch(/NETWORK|status/);
  });
});
