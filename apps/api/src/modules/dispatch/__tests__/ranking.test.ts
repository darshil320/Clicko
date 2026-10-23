import { describe, expect, it } from 'vitest';
import { rankCandidates, rankScore } from '../ranking';

const full = {
  ratingAvgBps: 5000,
  ratingCount: 10,
  acceptanceRateBps: 10_000,
  onTimeUploadRateBps: 10_000,
  noShowCount: 0,
};

describe('rankScore (ADR-0010: 0.35 proximity + 0.25 rating + 0.20 acceptance + 0.15 on-time − 0.05 no-shows)', () => {
  it('scores a perfect photographer at the venue 0.95', () => {
    expect(rankScore({ distanceKm: 0, reachKm: 8, metrics: full })).toBe(0.95);
  });

  it('proximity is 1 − distance / radius', () => {
    // 0.35 × (1 − 4/8) + 0.25 + 0.20 + 0.15 = 0.775
    expect(rankScore({ distanceKm: 4, reachKm: 8, metrics: full })).toBe(0.775);
    expect(rankScore({ distanceKm: 8, reachKm: 8, metrics: full })).toBe(0.6);
  });

  it('normalises rating from bps of 5 stars and rates from bps of 100%', () => {
    const m = { ...full, ratingAvgBps: 4000, acceptanceRateBps: 5000, onTimeUploadRateBps: 8000 };
    // 0.35 + 0.25×0.8 + 0.20×0.5 + 0.15×0.8 = 0.77
    expect(rankScore({ distanceKm: 0, reachKm: 8, metrics: m })).toBe(0.77);
  });

  it('counts missing metrics as 0.8 so new photographers are not buried', () => {
    // 0.35 + (0.25 + 0.20 + 0.15) × 0.8 = 0.83
    expect(rankScore({ distanceKm: 0, reachKm: 8, metrics: null })).toBe(0.83);
    const unrated = { ...full, ratingAvgBps: 4900, ratingCount: 0, acceptanceRateBps: null };
    // 0.35 + 0.25×0.8 + 0.20×0.8 + 0.15 = 0.86
    expect(rankScore({ distanceKm: 0, reachKm: 8, metrics: unrated })).toBe(0.86);
  });

  it('subtracts up to 0.05 for no-shows, capped at three', () => {
    expect(rankScore({ distanceKm: 0, reachKm: 8, metrics: { ...full, noShowCount: 1 } })).toBe(
      0.9333,
    );
    expect(rankScore({ distanceKm: 0, reachKm: 8, metrics: { ...full, noShowCount: 3 } })).toBe(
      0.9,
    );
    expect(rankScore({ distanceKm: 0, reachKm: 8, metrics: { ...full, noShowCount: 9 } })).toBe(
      0.9,
    );
  });

  it('never goes outside 0..1 for odd inputs', () => {
    expect(rankScore({ distanceKm: 30, reachKm: 8, metrics: full })).toBe(0.6);
    expect(rankScore({ distanceKm: 0, reachKm: 0, metrics: full })).toBe(0.6);
    const worst = {
      ratingAvgBps: 0,
      ratingCount: 3,
      acceptanceRateBps: 0,
      onTimeUploadRateBps: 0,
      noShowCount: 5,
    };
    expect(rankScore({ distanceKm: 8, reachKm: 8, metrics: worst })).toBe(0);
  });
});

describe('rankCandidates', () => {
  it('orders by score, then distance, then id — without mutating the input', () => {
    const input = [
      { id: 'c', distanceKm: 2, reachKm: 8, metrics: full },
      { id: 'b', distanceKm: 1, reachKm: 8, metrics: null },
      { id: 'a', distanceKm: 2, reachKm: 8, metrics: full },
      { id: 'd', distanceKm: 0.5, reachKm: 8, metrics: { ...full, noShowCount: 3 } },
    ];
    const ranked = rankCandidates(input);
    expect(ranked.map((r) => r.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(ranked[0]?.rankScore).toBe(0.8781);
    expect(input.map((r) => r.id)).toEqual(['c', 'b', 'a', 'd']);
  });
});
