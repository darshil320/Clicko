import { ApiError } from '@clickco/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { humanMessage, isNotFound, isOffline, userMessage } from './errors';
import {
  reportCacheAction,
  reportDeviceOnline,
  reportRequestError,
  useNetworkStore,
} from './network/store';
import { shouldRetry } from './query';
import { screenState } from './screen-state';

const network = (code = 'NETWORK') =>
  new ApiError({ kind: 'NETWORK', status: 0, code, message: 'x' });
const http = (status: number, code: string, message: string) =>
  new ApiError({ kind: 'HTTP', status, code, message });

describe('userMessage never shows framework text or codes', () => {
  it('replaces the API generic codes with plain words', () => {
    expect(userMessage(http(403, 'FORBIDDEN', 'Forbidden resource'))).toBe(
      "You don't have access to this.",
    );
    expect(userMessage(http(400, 'VALIDATION_FAILED', 'Request validation failed'))).toBe(
      "Something didn't look right. Please check and try again.",
    );
    expect(userMessage(http(404, 'NOT_FOUND', 'Not Found'))).toMatch(/couldn't find/);
  });

  it('turns the rate limiter default into a wait-and-retry line, but keeps a written one', () => {
    expect(userMessage(http(429, 'RATE_LIMITED', 'ThrottlerException: Too Many Requests'))).toBe(
      'Too many tries. Please wait a minute and try again.',
    );
    expect(
      userMessage(http(429, 'RATE_LIMITED', 'Too many codes requested. Try again in 2 minutes.')),
    ).toBe('Too many codes requested. Try again in 2 minutes.');
  });

  it('keeps a domain sentence and covers blank or unknown text', () => {
    expect(userMessage(http(404, 'BOOKING_NOT_FOUND', 'Booking not found'))).toBe(
      'Booking not found',
    );
    expect(humanMessage({ code: 'SOMETHING', message: '  ' })).toBe(
      'Something went wrong. Please try again.',
    );
    expect(humanMessage({ code: 'X', message: 'BadRequestException' })).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('says offline or slow for transport failures', () => {
    expect(userMessage(network())).toContain('offline');
    expect(userMessage(network('TIMEOUT'))).toContain('taking too long');
    expect(
      userMessage(new ApiError({ kind: 'INVALID_RESPONSE', status: 200, code: 'X', message: 'y' })),
    ).toContain('on our side');
  });
});

describe('failure classification', () => {
  it('counts only a missing answer as offline (the Pro queue rule)', () => {
    expect(isOffline(network())).toBe(true);
    expect(isOffline(network('TIMEOUT'))).toBe(true);
    expect(isOffline(http(503, 'UNAVAILABLE', 'down'))).toBe(false);
    expect(isOffline(new Error('boom'))).toBe(false);
  });

  it('treats 404 and a malformed id as a booking that will never load', () => {
    expect(isNotFound(http(404, 'BOOKING_NOT_FOUND', 'Booking not found'))).toBe(true);
    expect(isNotFound(http(400, 'VALIDATION_FAILED', 'Request validation failed'))).toBe(true);
    expect(isNotFound(http(0, 'INVALID_ID', 'That link is not valid'))).toBe(true);
    expect(shouldRetry(0, http(0, 'INVALID_ID', 'That link is not valid'))).toBe(false);
    expect(isNotFound(http(500, 'INTERNAL', 'x'))).toBe(false);
    expect(isNotFound(network())).toBe(false);
  });
});

describe('screenState with the app rules', () => {
  const base = { data: undefined, error: null, status: 'pending', fetchStatus: 'idle' } as const;

  it('shows offline with the plain sentence when the first load got no answer', () => {
    expect(screenState({ ...base, status: 'error', error: network() })).toEqual({
      kind: 'offline',
      message: 'You seem to be offline. Check your connection and try again.',
      retrying: false,
    });
  });

  it('shows a server failure as an error, never its raw text', () => {
    const state = screenState({ ...base, status: 'error', error: http(500, 'INTERNAL', 'stack') });
    expect(state).toEqual({
      kind: 'error',
      message: 'Something went wrong on our side. Please try again in a moment.',
      retrying: false,
    });
  });

  it('keeps loaded bookings on screen when a poll fails offline', () => {
    const state = screenState({
      data: ['CLK-1'],
      error: network(),
      status: 'error',
      fetchStatus: 'idle',
    });
    expect(state).toMatchObject({ kind: 'ready', stale: { kind: 'offline' } });
  });

  it('uses a screen rule for empty (e.g. no upcoming shoots in a non-empty list)', () => {
    const state = screenState(
      { data: ['past'], error: null, status: 'success', fetchStatus: 'idle' },
      (list) => !list.includes('upcoming'),
    );
    expect(state.kind).toBe('empty');
  });
});

describe('network status store', () => {
  beforeEach(() => {
    reportCacheAction({ type: 'success' });
    reportDeviceOnline(true);
  });

  const offline = () => {
    const { state } = useNetworkStore.getState();
    return state.unreachable || state.deviceOffline;
  };

  it('goes offline on a request with no answer and back on any answer', () => {
    reportCacheAction({ type: 'failed', error: network() });
    expect(offline()).toBe(true);
    reportCacheAction({ type: 'error', error: http(422, 'QUOTE_EXPIRED', 'Expired') });
    expect(offline()).toBe(false);
  });

  it('ignores local cache writes and follows the browser flag', () => {
    reportRequestError(network());
    reportCacheAction({ type: 'success', manual: true });
    expect(offline()).toBe(true);
    reportCacheAction({ type: 'success' });
    reportDeviceOnline(false);
    expect(offline()).toBe(true);
    reportDeviceOnline(true);
    expect(offline()).toBe(false);
  });
});
