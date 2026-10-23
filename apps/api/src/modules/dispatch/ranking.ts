import type { PhotographerMetrics } from '../photographers/photographers.types';
import { DISPATCH_CONFIG } from './dispatch.config';

/**
 * ADR-0010 ranking, score 0–1 (stored in dispatch_attempts.rank_score, numeric(8,4)). A float is
 * fine here: it orders candidates, it is never money.
 */
export interface RankInput {
  readonly distanceKm: number;
  /** The radius the candidate qualified under: min(own service radius, wave radius). */
  readonly reachKm: number;
  readonly metrics: PhotographerMetrics | null;
}

const W = DISPATCH_CONFIG.ranking;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const ratio = (bps: number | null | undefined, full: number): number =>
  bps === null || bps === undefined ? W.missingMetric : clamp01(bps / full);

export function rankScore(c: RankInput): number {
  const m = c.metrics;
  const proximity = c.reachKm > 0 ? clamp01(1 - c.distanceKm / c.reachKm) : 0;
  const rating = m && m.ratingCount > 0 ? ratio(m.ratingAvgBps, 5_000) : W.missingMetric;
  const acceptance = ratio(m?.acceptanceRateBps, 10_000);
  const onTime = ratio(m?.onTimeUploadRateBps, 10_000);
  const noShows = Math.min(m?.noShowCount ?? 0, W.noShowCap) / W.noShowCap;
  const score =
    W.proximity * proximity +
    W.rating * rating +
    W.acceptance * acceptance +
    W.onTimeUpload * onTime -
    W.noShowPenalty * noShows;
  return Math.round(clamp01(score) * 10_000) / 10_000;
}

/** Best first; ties go to the nearer photographer, then to the id (deterministic). */
export function rankCandidates<T extends RankInput & { readonly id: string }>(
  candidates: readonly T[],
): Array<T & { readonly rankScore: number }> {
  return candidates
    .map((c) => ({ ...c, rankScore: rankScore(c) }))
    .sort(
      (a, b) =>
        b.rankScore - a.rankScore || a.distanceKm - b.distanceKm || a.id.localeCompare(b.id),
    );
}
