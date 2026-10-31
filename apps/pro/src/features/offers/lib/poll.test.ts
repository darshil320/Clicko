import { describe, expect, it } from 'vitest';
import {
  backoffDelay,
  INITIAL_BASELINE,
  jitterOf,
  nextBaseline,
  OFFER_POLL_MAX_MS,
  OFFER_POLL_MS,
  offerPollDelay,
  type PollQueryState,
} from './poll';

const healthy: PollQueryState = {
  status: 'success',
  dataUpdatedAt: 1_000,
  errorUpdatedAt: 0,
  errorUpdateCount: 0,
};

describe('backoffDelay', () => {
  it('keeps the healthy cadence with no failures', () => {
    expect(backoffDelay(0, 0.5)).toBe(OFFER_POLL_MS);
  });

  it('doubles the ceiling per failure and waits in its upper half', () => {
    // 1 failure: ceiling 20 s → [10 s, 20 s]
    expect(backoffDelay(1, 0)).toBe(10_000);
    expect(backoffDelay(1, 0.999)).toBe(19_990);
    // 3 failures: ceiling 80 s → [40 s, 80 s]
    expect(backoffDelay(3, 0)).toBe(40_000);
    expect(backoffDelay(3, 0.5)).toBe(60_000);
  });

  it('caps at 120 s however many failures', () => {
    expect(backoffDelay(4, 0.999)).toBeLessThanOrEqual(OFFER_POLL_MAX_MS);
    expect(backoffDelay(50, 0.999)).toBeLessThanOrEqual(OFFER_POLL_MAX_MS);
    expect(backoffDelay(50, 0)).toBe(OFFER_POLL_MAX_MS / 2);
  });

  it('never goes below the healthy cadence, even with an out-of-range jitter', () => {
    expect(backoffDelay(1, -5)).toBe(OFFER_POLL_MS);
    expect(backoffDelay(2, 7)).toBe(40_000);
  });
});

describe('jitterOf', () => {
  it('is a stable fraction in [0, 1) from the failure instant', () => {
    expect(jitterOf(1_700_000_000_250)).toBe(0.25);
    expect(jitterOf(1_700_000_000_999)).toBeCloseTo(0.999);
    expect(jitterOf(1_700_000_000_000)).toBe(0);
  });
});

describe('nextBaseline', () => {
  it('moves when fresh data lands, recording the error count at that moment', () => {
    const state = { ...healthy, dataUpdatedAt: 5_000, errorUpdateCount: 3 };
    expect(nextBaseline(state, INITIAL_BASELINE)).toEqual({ dataUpdatedAt: 5_000, errorCount: 3 });
  });

  it('returns the same object while no new data has landed', () => {
    const baseline = { dataUpdatedAt: 5_000, errorCount: 3 };
    const failing: PollQueryState = {
      status: 'error',
      dataUpdatedAt: 5_000,
      errorUpdatedAt: 9_000,
      errorUpdateCount: 5,
    };
    expect(nextBaseline(failing, baseline)).toBe(baseline);
  });
});

describe('offerPollDelay', () => {
  it('polls every 10 s while healthy', () => {
    expect(offerPollDelay(healthy, INITIAL_BASELINE)).toBe(OFFER_POLL_MS);
  });

  it('backs off by the failures since the last success', () => {
    const baseline = { dataUpdatedAt: 1_000, errorCount: 2 };
    const failing = (count: number): PollQueryState => ({
      status: 'error',
      dataUpdatedAt: 1_000,
      errorUpdatedAt: 42_000, // jitter 0
      errorUpdateCount: count,
    });
    expect(offerPollDelay(failing(3), baseline)).toBe(10_000); // 1 in a row
    expect(offerPollDelay(failing(4), baseline)).toBe(20_000); // 2 in a row
    expect(offerPollDelay(failing(5), baseline)).toBe(40_000); // 3 in a row
    expect(offerPollDelay(failing(12), baseline)).toBe(60_000); // capped ceiling 120 s
  });

  it('treats an error state as at least one failure', () => {
    const baseline = { dataUpdatedAt: 1_000, errorCount: 4 };
    const failing: PollQueryState = {
      status: 'error',
      dataUpdatedAt: 1_000,
      errorUpdatedAt: 2_500,
      errorUpdateCount: 4,
    };
    expect(offerPollDelay(failing, baseline)).toBe(15_000);
  });
});
