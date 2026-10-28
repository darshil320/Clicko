import { ApiError } from '@clickco/api-client';
import { describe, expect, it } from 'vitest';
import {
  applyOutcome,
  classifyFailure,
  dismissFailed,
  dueHeads,
  EMPTY_QUEUE,
  enqueue,
  isOffline,
  type NewQueuedAction,
  pendingFor,
  type QueueState,
  retryDelayMs,
  retryNow,
} from './queue';

const ME = 'p-1';
const JOB_A = 'a-1';
const JOB_B = 'b-1';
const T0 = new Date('2026-11-14T10:50:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

const fix = { lat: 21.17, lng: 72.83, accuracyM: 12, deviceTs: T0.toISOString(), mocked: false };

function item(
  id: string,
  assignmentId: string,
  action: NewQueuedAction['action'],
): NewQueuedAction {
  return { id, photographerId: ME, assignmentId, action, idempotencyKey: `key-${id}` };
}

const http = (status: number, code: string) =>
  new ApiError({ kind: 'HTTP', status, code, message: `${code} message` });

function queueOf(...items: NewQueuedAction[]): QueueState {
  return items.reduce((state, next) => enqueue(state, next, T0), EMPTY_QUEUE);
}

describe('enqueue', () => {
  it('marks geofenced bodies offline so the server trusts the device time, keeping deviceTs', () => {
    const state = queueOf(item('1', JOB_A, { kind: 'CHECK_IN', body: { ...fix, offline: false } }));
    const queued = state.pending[0];
    expect(queued?.action).toEqual({ kind: 'CHECK_IN', body: { ...fix, offline: true } });
    expect(queued?.attempts).toBe(0);
    expect(queued?.nextAttemptAt).toBe(T0.toISOString());
  });

  it('leaves actions without a fix untouched and never mutates the previous state', () => {
    const before = queueOf(item('1', JOB_A, { kind: 'START' }));
    const after = enqueue(
      before,
      item('2', JOB_A, { kind: 'EXTENSION', deviceTs: T0.toISOString() }),
      T0,
    );
    expect(before.pending).toHaveLength(1);
    expect(after.pending.map((p) => p.action.kind)).toEqual(['START', 'EXTENSION']);
  });
});

describe('dueHeads', () => {
  it('sends only the oldest action of each assignment, so nothing overtakes a check-in', () => {
    const state = queueOf(
      item('1', JOB_A, { kind: 'CHECK_IN', body: fix }),
      item('2', JOB_A, { kind: 'START' }),
      item('3', JOB_B, { kind: 'EN_ROUTE' }),
    );
    expect(dueHeads(state, ME, T0).map((h) => h.id)).toEqual(['1', '3']);
  });

  it('waits for the retry time, and holds the rest of that assignment behind it', () => {
    let state = queueOf(
      item('1', JOB_A, { kind: 'CHECK_IN', body: fix }),
      item('2', JOB_A, { kind: 'START' }),
    );
    state = applyOutcome(state, '1', { type: 'RETRY', message: 'offline' }, T0);
    expect(dueHeads(state, ME, later(10_000))).toEqual([]);
    expect(dueHeads(state, ME, later(15_000)).map((h) => h.id)).toEqual(['1']);
  });

  it("ignores another photographer's leftovers on a shared phone", () => {
    const state = enqueue(
      EMPTY_QUEUE,
      { ...item('1', JOB_A, { kind: 'START' }), photographerId: 'p-2' },
      T0,
    );
    expect(dueHeads(state, ME, T0)).toEqual([]);
  });
});

describe('applyOutcome', () => {
  it('drops a delivered action and lets the next one through', () => {
    let state = queueOf(
      item('1', JOB_A, { kind: 'CHECK_IN', body: fix }),
      item('2', JOB_A, { kind: 'START' }),
    );
    state = applyOutcome(state, '1', { type: 'DONE' }, T0);
    expect(state.pending.map((p) => p.id)).toEqual(['2']);
    expect(dueHeads(state, ME, T0).map((h) => h.id)).toEqual(['2']);
  });

  it('backs off on retries: 15 s, 30 s, 1 min … capped at 5 min', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(retryDelayMs)).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000,
    ]);
    let state = queueOf(item('1', JOB_A, { kind: 'START' }));
    state = applyOutcome(state, '1', { type: 'RETRY', message: 'offline' }, T0);
    state = applyOutcome(state, '1', { type: 'RETRY', message: 'still offline' }, T0);
    expect(state.pending[0]).toMatchObject({
      attempts: 2,
      lastError: 'still offline',
      nextAttemptAt: later(30_000).toISOString(),
    });
  });

  it("moves a rejected action to 'needs attention' with the server's words", () => {
    let state = queueOf(item('1', JOB_A, { kind: 'CHECK_IN', body: fix }));
    state = applyOutcome(
      state,
      '1',
      { type: 'REJECTED', code: 'ASSIGNMENT_NOT_ACTIVE', message: 'This job is no longer yours' },
      T0,
    );
    expect(state.pending).toEqual([]);
    expect(state.failed[0]).toMatchObject({
      id: '1',
      code: 'ASSIGNMENT_NOT_ACTIVE',
      failedAt: T0.toISOString(),
    });
    expect(dismissFailed(state, '1').failed).toEqual([]);
  });

  it('ignores an id it does not hold', () => {
    const state = queueOf(item('1', JOB_A, { kind: 'START' }));
    expect(applyOutcome(state, 'nope', { type: 'DONE' }, T0)).toBe(state);
  });
});

describe('classifyFailure', () => {
  it('retries no answer, rate limits, server errors and an in-flight duplicate', () => {
    expect(
      classifyFailure(new ApiError({ kind: 'NETWORK', status: 0, code: 'OFFLINE', message: 'x' }))
        .type,
    ).toBe('RETRY');
    expect(classifyFailure(http(429, 'RATE_LIMITED')).type).toBe('RETRY');
    expect(classifyFailure(http(503, 'UNAVAILABLE')).type).toBe('RETRY');
    expect(classifyFailure(http(409, 'IDEMPOTENCY_REQUEST_IN_PROGRESS')).type).toBe('RETRY');
  });

  it("stops on the server's final word", () => {
    expect(classifyFailure(http(422, 'OUTSIDE_GEOFENCE'))).toEqual({
      type: 'REJECTED',
      code: 'OUTSIDE_GEOFENCE',
      message: 'OUTSIDE_GEOFENCE message',
    });
    expect(classifyFailure(http(409, 'ASSIGNMENT_NOT_ACTIVE')).type).toBe('REJECTED');
  });

  it('queues a fresh action only when nothing answered', () => {
    expect(
      isOffline(new ApiError({ kind: 'NETWORK', status: 0, code: 'TIMEOUT', message: 'x' })),
    ).toBe(true);
    expect(isOffline(http(503, 'UNAVAILABLE'))).toBe(false);
    expect(isOffline(new Error('boom'))).toBe(false);
  });
});

describe('helpers', () => {
  it('lists one assignment’s pending actions and retries everything now on demand', () => {
    let state = queueOf(
      item('1', JOB_A, { kind: 'START' }),
      item('2', JOB_B, { kind: 'EN_ROUTE' }),
    );
    state = applyOutcome(state, '1', { type: 'RETRY', message: 'offline' }, T0);
    expect(pendingFor(state, JOB_A).map((p) => p.id)).toEqual(['1']);
    expect(dueHeads(retryNow(state, T0), ME, T0).map((h) => h.id)).toEqual(['1', '2']);
  });
});
