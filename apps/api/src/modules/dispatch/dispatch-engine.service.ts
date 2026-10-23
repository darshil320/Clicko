import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import type { DispatchFacts } from '../bookings/bookings.types';
import { PhotographersService } from '../photographers/photographers.service';
import type { DispatchTimer, OfferCandidate, RoundRecord, Tx } from './dispatch.types';
import { rankCandidates } from './ranking';
import { AttemptsRepository } from './repositories/attempts.repository';
import { EligibilityRepository } from './repositories/eligibility.repository';
import { RoundsRepository } from './repositories/rounds.repository';
import { DispatchRunState } from './run-state.service';
import { VenuePoints } from './venue-points';
import {
  calendarBlock,
  type DispatchMode,
  modeFor,
  nextWaveNumber,
  nextWaveSpec,
  type RunKind,
  type WaveSpec,
  waveClosesAt,
  waveSpec,
} from './wave-plan';

interface RunContext {
  readonly kind: RunKind;
  readonly mode: DispatchMode;
  /** What every offer of this run pays (the no-show incentive included). */
  readonly payoutPaise: bigint;
  /** Wave number of the run's first round. */
  readonly runFromWave: number;
}

/**
 * The cascade itself (ADR-0010): opens waves, skips empty ones, declares exhaustion. Every method
 * runs inside the caller's transaction, with the booking row already locked, and returns the
 * timers to schedule once that transaction commits.
 */
@Injectable()
export class DispatchEngine {
  constructor(
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(VenuePoints) private readonly venues: VenuePoints,
    @Inject(RoundsRepository) private readonly rounds: RoundsRepository,
    @Inject(AttemptsRepository) private readonly attempts: AttemptsRepository,
    @Inject(EligibilityRepository) private readonly eligibility: EligibilityRepository,
    @Inject(DispatchRunState) private readonly runs: DispatchRunState,
  ) {}

  /** A new search: the initial dispatch, or a re-dispatch (ADR-0011). */
  async startRun(tx: Tx, facts: DispatchFacts, kind: RunKind, now: Date): Promise<DispatchTimer[]> {
    const rounds = await this.rounds.forBooking(tx, facts.bookingId);
    const ctx: RunContext = {
      kind,
      mode: modeFor(facts.emergencyBand, kind),
      payoutPaise: this.runs.payoutFor(facts, kind),
      runFromWave: nextWaveNumber(rounds),
    };
    const timers = await this.openWaves(tx, facts, ctx, [], now);
    return [...timers, ...(await this.deadlineTimers(facts, kind, now, now))];
  }

  /** The current wave ended unfilled: open the next one, or declare the run exhausted. */
  async continueRun(tx: Tx, facts: DispatchFacts, now: Date): Promise<DispatchTimer[]> {
    const run = await this.runs.currentRun(tx, facts.bookingId);
    const first = run[0];
    if (!first || run.some((r) => r.endedAt === null)) return [];
    const kind = await this.runs.kind(tx, facts.bookingId);
    const ctx: RunContext = {
      kind,
      mode: first.isBroadcast ? 'BROADCAST' : 'CASCADE',
      payoutPaise: this.runs.payoutFor(facts, kind),
      runFromWave: first.wave,
    };
    return this.openWaves(tx, facts, ctx, run, now);
  }

  /** Timers a DISPATCHING booking should have (re-armed on an at-least-once redelivery). */
  async pendingTimers(tx: Tx, facts: DispatchFacts, now: Date): Promise<DispatchTimer[]> {
    const open = await this.rounds.openForBooking(tx, facts.bookingId);
    const expiry: DispatchTimer[] = open
      ? [{ kind: 'WAVE_EXPIRY', roundId: open.id, at: waveClosesAt(open) }]
      : [];
    const run = await this.runs.currentRun(tx, facts.bookingId);
    const kind = await this.runs.kind(tx, facts.bookingId);
    const startedAt = run[0]?.startedAt ?? now;
    return [...expiry, ...(await this.deadlineTimers(facts, kind, startedAt, now))];
  }

  private async openWaves(
    tx: Tx,
    facts: DispatchFacts,
    ctx: RunContext,
    run: readonly RoundRecord[],
    now: Date,
  ): Promise<DispatchTimer[]> {
    let soFar = run;
    for (;;) {
      const spec = soFar.length === 0 ? waveSpec(ctx.mode, 0) : nextWaveSpec(soFar);
      if (!spec) {
        await this.exhausted(tx, facts, ctx, soFar, now);
        return [];
      }
      const round = await this.openRound(tx, facts, spec, ctx, ctx.runFromWave + soFar.length, now);
      if (round.endedAt === null) {
        return [{ kind: 'WAVE_EXPIRY', roundId: round.id, at: waveClosesAt(round) }];
      }
      soFar = [...soFar, round];
    }
  }

  /** One wave: rank, record the round, offer. An empty wave is recorded and closed at once. */
  private async openRound(
    tx: Tx,
    facts: DispatchFacts,
    spec: WaveSpec,
    ctx: RunContext,
    wave: number,
    now: Date,
  ): Promise<RoundRecord> {
    const candidates = await this.candidates(tx, facts, spec, ctx.runFromWave);
    const round = await this.rounds.insert(tx, {
      bookingId: facts.bookingId,
      wave,
      radiusKm: spec.radiusKm,
      candidateCount: candidates.length,
      windowSeconds: spec.windowSeconds,
      isBroadcast: spec.isBroadcast,
      startedAt: now,
    });
    if (candidates.length === 0) {
      await this.rounds.end(tx, round.id, 'EXHAUSTED', now);
      return { ...round, endedAt: now, outcome: 'EXHAUSTED' };
    }
    const expiresAt = waveClosesAt(round);
    await this.attempts.insertMany(tx, {
      roundId: round.id,
      bookingId: facts.bookingId,
      candidates,
      payoutPaise: ctx.payoutPaise,
      notifiedAt: now,
      expiresAt,
    });
    await appendDomainEvent(tx, {
      eventType: 'dispatch.wave_opened',
      aggregateKind: 'booking',
      aggregateId: facts.bookingId,
      occurredAt: now,
      payload: {
        booking_id: facts.bookingId,
        round_id: round.id,
        wave,
        is_broadcast: spec.isBroadcast,
        expires_at: expiresAt.toISOString(),
        offered_payout_paise: fromPaiseBigint(ctx.payoutPaise),
        photographer_ids: candidates.map((c) => c.photographerId),
      },
    });
    return round;
  }

  /** Hard filters (photographers module + the geo query), then ranking, then the wave's cut. */
  private async candidates(
    tx: Tx,
    facts: DispatchFacts,
    spec: WaveSpec,
    runFromWave: number,
  ): Promise<OfferCandidate[]> {
    const block = calendarBlock(facts.scheduledStart, facts.scheduledEnd);
    const pool = await this.photographers.dispatchPool(tx, {
      cityId: facts.cityId,
      tier: facts.tier,
      categoryId: facts.categoryId,
      certRequiredFrom: facts.certRequiredFrom,
      shootStart: facts.scheduledStart,
      shootEnd: facts.scheduledEnd,
      blockedFrom: block.from,
      blockedUntil: block.until,
      emergencyOnly: spec.isBroadcast,
      needsDroneCredentials: facts.needsDroneCredentials,
    });
    if (pool.length === 0) return [];
    const reachable = await this.eligibility.reachable(tx, {
      bookingId: facts.bookingId,
      venue: await this.venuePoint(facts),
      pool,
      waveRadiusKm: spec.waveRadiusKm,
      blockedFrom: block.from,
      blockedUntil: block.until,
      runFromWave,
    });
    const metrics = new Map(pool.map((p) => [p.id, p.metrics]));
    const ranked = rankCandidates(
      reachable.map((r) => ({
        ...r,
        id: r.photographerId,
        metrics: metrics.get(r.photographerId) ?? null,
      })),
    );
    const chosen = spec.offers === null ? ranked : ranked.slice(0, spec.offers);
    return chosen.map((c) => ({
      photographerId: c.id,
      distanceKm: c.distanceKm,
      rankScore: c.rankScore,
    }));
  }

  /** ADR-0010 fallback chain: geocoded venue → pincode centroid → city centre. */
  private async venuePoint(facts: DispatchFacts): Promise<string> {
    return (await this.venues.resolve(facts)).point;
  }

  /**
   * dispatch.exhausted for the ops desk. A first search stays DISPATCHING (ops may still find
   * someone before the deadline); a failed replacement ends the booking now (ADR-0012 D6).
   */
  private async exhausted(
    tx: Tx,
    facts: DispatchFacts,
    ctx: RunContext,
    run: readonly RoundRecord[],
    now: Date,
  ): Promise<void> {
    await appendDomainEvent(tx, {
      eventType: 'dispatch.exhausted',
      aggregateKind: 'booking',
      aggregateId: facts.bookingId,
      occurredAt: now,
      payload: {
        booking_id: facts.bookingId,
        emergency_band: facts.emergencyBand,
        run_kind: ctx.kind,
        waves: run.map((r) => r.wave),
        is_broadcast: run[0]?.isBroadcast ?? false,
      },
    });
    if (ctx.kind !== 'INITIAL') {
      await this.runs.terminate(
        tx,
        facts.bookingId,
        ctx.kind,
        now,
        'No replacement photographer accepted',
      );
    }
  }

  /** ADR-0012 D1: the booking is auto-cancelled at its deadline if still unfilled. */
  private async deadlineTimers(
    facts: DispatchFacts,
    kind: RunKind,
    runStartedAt: Date,
    now: Date,
  ): Promise<DispatchTimer[]> {
    const deadline = await this.runs.deadline(facts);
    if (!this.runs.deadlineApplies(kind, runStartedAt, deadline)) return [];
    const at = new Date(Math.max(deadline.getTime(), now.getTime()));
    return [{ kind: 'DEADLINE', bookingId: facts.bookingId, at }];
  }
}
