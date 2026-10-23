import type { BookingStatus, EmergencyBand } from '@clickco/contracts';
import { DISPATCH_CONFIG, EMERGENCY_BANDS } from './dispatch.config';

/**
 * Pure cascade/broadcast planning (ADR-0010). A "run" is one search for a photographer: the
 * initial dispatch, or a re-dispatch after a cancellation/no-show (ADR-0011). Waves are numbered
 * across the whole booking because dispatch_rounds is unique on (booking_id, wave).
 */
export type DispatchMode = 'CASCADE' | 'BROADCAST';
export type RunKind = 'INITIAL' | 'PRO_CANCELLED' | 'NO_SHOW';

export interface WaveSpec {
  readonly isBroadcast: boolean;
  /** The wave's own distance limit; null = city-wide. */
  readonly waveRadiusKm: number | null;
  /** What dispatch_rounds.radius_km records. */
  readonly radiusKm: number;
  /** null = every remaining eligible photographer. */
  readonly offers: number | null;
  readonly windowSeconds: number;
}

/** The subset of a dispatch_rounds row the plan needs. */
export interface RoundSummary {
  readonly wave: number;
  readonly isBroadcast: boolean;
  readonly outcome: string | null;
}

export function modeFor(band: EmergencyBand, kind: RunKind): DispatchMode {
  return kind === 'NO_SHOW' || EMERGENCY_BANDS.includes(band) ? 'BROADCAST' : 'CASCADE';
}

/** Step `step` (0-based) of a run in `mode`; null once the run has no waves left. */
export function waveSpec(mode: DispatchMode, step: number): WaveSpec | null {
  if (mode === 'BROADCAST') {
    return step === 0
      ? {
          isBroadcast: true,
          waveRadiusKm: null,
          radiusKm: DISPATCH_CONFIG.cityWideRadiusKm,
          offers: null,
          windowSeconds: DISPATCH_CONFIG.broadcastWindowSeconds,
        }
      : null;
  }
  const s = DISPATCH_CONFIG.cascade[step];
  if (!s) return null;
  return {
    isBroadcast: false,
    waveRadiusKm: s.radiusKm,
    radiusKm: s.radiusKm ?? DISPATCH_CONFIG.cityWideRadiusKm,
    offers: s.offers,
    windowSeconds: s.windowSeconds,
  };
}

/** The rounds of the run in progress: everything after the last FILLED round. */
export function currentRun<T extends RoundSummary>(rounds: readonly T[]): T[] {
  const ordered = [...rounds].sort((a, b) => a.wave - b.wave);
  const lastFilled = ordered.map((r) => r.outcome).lastIndexOf('FILLED');
  return ordered.slice(lastFilled + 1);
}

/** The wave after `run` (non-empty): a broadcast run has one wave; a cascade run has four. */
export function nextWaveSpec(run: readonly RoundSummary[]): WaveSpec | null {
  const first = run[0];
  if (!first) throw new Error('nextWaveSpec: empty run — start a run with waveSpec(mode, 0)');
  return waveSpec(first.isBroadcast ? 'BROADCAST' : 'CASCADE', run.length);
}

export function nextWaveNumber(rounds: readonly RoundSummary[]): number {
  return rounds.reduce((max, r) => Math.max(max, r.wave), 0) + 1;
}

export interface TerminalOutcome {
  readonly to: Extract<BookingStatus, 'CANCELLED_PRO' | 'PRO_NO_SHOW'>;
  readonly reason: 'UNFILLED' | 'REDISPATCH_UNFILLED' | 'NO_SHOW_UNFILLED';
}

/**
 * Where a booking ends when its search fails (ADR-0012 D1/D6): an unfilled first search or a
 * failed replacement after a cancellation is CANCELLED_PRO; a failed no-show replacement is
 * PRO_NO_SHOW. (An exhausted INITIAL run waits for the ops desk until its deadline.)
 */
export function terminalFor(kind: RunKind): TerminalOutcome {
  if (kind === 'NO_SHOW') return { to: 'PRO_NO_SHOW', reason: 'NO_SHOW_UNFILLED' };
  return { to: 'CANCELLED_PRO', reason: kind === 'INITIAL' ? 'UNFILLED' : 'REDISPATCH_UNFILLED' };
}

export interface CalendarBlock {
  readonly from: Date;
  readonly until: Date;
}

/** The window an assignment occupies: shoot ± the travel buffer (G-28, ADR-0010). */
export function calendarBlock(start: Date, end: Date): CalendarBlock {
  const buffer = DISPATCH_CONFIG.travelBufferMinutes * 60_000;
  return { from: new Date(start.getTime() - buffer), until: new Date(end.getTime() + buffer) };
}

/** When a wave's offers stop being acceptable. */
export function waveClosesAt(round: {
  readonly startedAt: Date;
  readonly windowSeconds: number;
}): Date {
  return new Date(round.startedAt.getTime() + round.windowSeconds * 1000);
}
