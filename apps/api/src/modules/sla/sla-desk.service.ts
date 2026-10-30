import type { SlaClockView, SlaKind } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import type { IdSubquery } from '../../infra/db/id-subquery';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import {
  type BreachPageQuery,
  type BreachRecord,
  isOwed,
  SlaBreachesRepository,
} from './repositories/sla-breaches.repository';

/** ADR-0016 D9: staff move a breach off Clickco and the photographer, never onto them. */
const REATTRIBUTABLE = ['CLIENT', 'FORCE_MAJEURE'] as const;
type Reattribution = (typeof REATTRIBUTABLE)[number];

import { SlaClocksRepository } from './repositories/sla-clocks.repository';
import { effectiveDueAt } from './rules/schedule';
import type { SlaClockRecord, Tx } from './sla.types';

/** The production ladder: what "the next SLA due" means on the booking board. */
const PRODUCTION: readonly SlaKind[] = [
  'UPLOAD_START',
  'UPLOAD_COMPLETE',
  'PROCESSING_COMPLETE',
  'QA_COMPLETE',
  'DELIVERY_RED_ALERT',
  'DELIVERY_DUE',
];

export interface SlaBoardFacts {
  /** The earliest running production clock's effective due time. */
  readonly nextDueAt: Date | null;
  /** DELIVERY_DUE's effective due time (the promise), whatever its state. */
  readonly deliveryDueAt: Date | null;
  /**
   * The delivery promise (DELIVERY_DUE) breached and its breach not waived. Missed internal
   * milestones are not this flag: they reach ops as `sla.milestone_missed` alerts.
   */
  readonly breached: boolean;
}

const BREACH_NOT_FOUND = { code: 'BREACH_NOT_FOUND', message: 'Breach not found' };

/**
 * A recorded payout deduction (ADR-0026 D2/D3): an applied breach put down to the photographer.
 * Payouts (stream B) cut `payoutDeductionBps` of the photographer's expected payout for it.
 */
export interface AppliedDeduction {
  readonly breachId: string;
  readonly bookingId: string;
  readonly payoutDeductionBps: number;
  readonly appliedAt: Date;
}

export const toClockView = (c: SlaClockRecord): SlaClockView => ({
  kind: c.kind,
  state: c.state,
  dueAt: c.dueAt.toISOString(),
  effectiveDueAt: effectiveDueAt(c.dueAt, c.pausedMs).toISOString(),
  paused: c.pausedAt !== null,
  metAt: c.metAt?.toISOString() ?? null,
  breachedAt: c.breachedAt?.toISOString() ?? null,
});

/**
 * The SLA side of the staff panel (ADR-0025 D5): clock and breach reads, and the two S9 breach
 * decisions — re-attribution and waiver. Neither moves money: the remedy stays unapplied (S10).
 */
@Injectable()
export class SlaDeskService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(SlaClocksRepository) private readonly clocks: SlaClocksRepository,
    @Inject(SlaBreachesRepository) private readonly breaches: SlaBreachesRepository,
  ) {}

  async boardFacts(bookingIds: readonly string[]): Promise<Map<string, SlaBoardFacts>> {
    const [clocks, settled] = await Promise.all([
      this.clocks.forBookings(this.sql, bookingIds),
      this.settledClockIds(bookingIds),
    ]);
    const out = new Map<string, SlaBoardFacts>();
    for (const id of bookingIds) {
      const mine = clocks.filter((c) => c.bookingId === id);
      const running = mine
        .filter((c) => c.state === 'ARMED' && c.pausedAt === null && PRODUCTION.includes(c.kind))
        .map((c) => effectiveDueAt(c.dueAt, c.pausedMs).getTime());
      const promise = mine.find((c) => c.kind === 'DELIVERY_DUE');
      out.set(id, {
        nextDueAt: running.length > 0 ? new Date(Math.min(...running)) : null,
        deliveryDueAt: promise ? effectiveDueAt(promise.dueAt, promise.pausedMs) : null,
        breached: promise?.state === 'BREACHED' && !settled.has(promise.id),
      });
    }
    return out;
  }

  async clockViews(bookingId: string): Promise<SlaClockView[]> {
    return (await this.clocks.forBooking(this.sql, bookingId)).map(toClockView);
  }

  /**
   * Deliveries promised by `until` and not yet made (the running DELIVERY_DUE clock), on the
   * bookings of an owner-built subquery — the staff panel's Today number (ADR-0026 D8).
   */
  deliveriesDueCount(bookings: IdSubquery, until: Date): Promise<number> {
    return this.clocks.countRunningDue(this.sql, 'DELIVERY_DUE', bookings, until);
  }

  breachesForBooking(bookingId: string): Promise<BreachRecord[]> {
    return this.breaches.forBooking(this.sql, bookingId);
  }

  breachPage(q: BreachPageQuery): Promise<BreachRecord[]> {
    return this.breaches.page(this.sql, q);
  }

  async breachBookingId(breachId: string): Promise<string | null> {
    return (await this.breaches.find(this.sql, breachId))?.bookingId ?? null;
  }

  /** Who caused the delay (ADR-0016 D9): CLIENT or FORCE_MAJEURE means nothing is owed (S10). */
  async attribute(
    breachId: string,
    to: Reattribution,
    staffId: string,
    note: string,
    now: Date,
    hook?: TxHook,
  ): Promise<BreachRecord> {
    if (!REATTRIBUTABLE.includes(to)) {
      throw new ConflictException({
        code: 'ATTRIBUTION_NOT_ALLOWED',
        message: 'A breach can only be put down to the client or force majeure',
      });
    }
    return this.sql.begin(async (tx) => {
      const before = await this.lockOpen(tx, breachId);
      await this.breaches.setAttribution(tx, breachId, to);
      await appendDomainEvent(tx, {
        eventType: 'sla.breach_attributed',
        aggregateKind: 'booking',
        aggregateId: before.bookingId,
        occurredAt: now,
        payload: {
          booking_id: before.bookingId,
          breach_id: breachId,
          from: before.attributedTo,
          to,
          staff_id: staffId,
        },
      });
      const after = { ...before, attributedTo: to };
      await hook?.(tx, {
        before: { attributed_to: before.attributedTo },
        after: { attributed_to: to, note },
      });
      return after;
    });
  }

  /** No remedy will be applied for this breach (ADR-0025 D5). */
  async waive(
    breachId: string,
    staffId: string,
    reason: string,
    now: Date,
    hook?: TxHook,
  ): Promise<BreachRecord> {
    return this.sql.begin(async (tx) => {
      const before = await this.lockOpen(tx, breachId);
      await this.breaches.waive(tx, breachId, staffId, reason);
      await appendDomainEvent(tx, {
        eventType: 'sla.breach_waived',
        aggregateKind: 'booking',
        aggregateId: before.bookingId,
        occurredAt: now,
        payload: {
          booking_id: before.bookingId,
          breach_id: breachId,
          staff_id: staffId,
          reason,
        },
      });
      await hook?.(tx, {
        before: { waived: false },
        after: { waived: true, waive_reason: reason },
      });
      return { ...before, waivedBy: staffId, waiveReason: reason };
    });
  }

  /** One breach, unlocked (review items show it). */
  breach(breachId: string): Promise<BreachRecord | null> {
    return this.breaches.find(this.sql, breachId);
  }

  /**
   * ADR-0026 D2 — for the payouts module: every applied breach on these bookings that was put
   * down to the photographer, with its deduction. CLICKCO-attributed breaches cost the photographer
   * nothing; waived, re-attributed and unapplied breaches are not deductions.
   */
  async appliedDeductions(bookingIds: readonly string[]): Promise<AppliedDeduction[]> {
    const all = await this.breaches.forBookings(this.sql, bookingIds);
    return all.flatMap((b) =>
      b.appliedAt !== null &&
      b.waivedBy === null &&
      b.attributedTo === 'PHOTOGRAPHER' &&
      b.payoutDeductionBps > 0
        ? [
            {
              breachId: b.id,
              bookingId: b.bookingId,
              payoutDeductionBps: b.payoutDeductionBps,
              appliedAt: b.appliedAt,
            },
          ]
        : [],
    );
  }

  /** Locks a breach for applying its remedy, in the caller's tx (lock order: booking first). */
  async lockForRemedy(tx: Tx, breachId: string): Promise<BreachRecord> {
    const breach = await this.breaches.lock(tx, breachId);
    if (!breach) throw new NotFoundException(BREACH_NOT_FOUND);
    return breach;
  }

  /**
   * ADR-0026 D2: the remedy of an owed breach (`isOwed`) was applied — `applied_at` set, which
   * records the payout deduction — with `sla.breach_applied`, in the caller's tx.
   */
  async markRemedyApplied(
    tx: Tx,
    breach: BreachRecord,
    staffId: string,
    now: Date,
  ): Promise<BreachRecord> {
    if (!isOwed(breach) || !(await this.breaches.markApplied(tx, breach.id, now))) {
      throw new ConflictException({
        code: 'BREACH_NOT_OWED',
        message: 'This late delivery owes nothing now (already applied, waived or re-attributed)',
      });
    }
    await appendDomainEvent(tx, {
      eventType: 'sla.breach_applied',
      aggregateKind: 'booking',
      aggregateId: breach.bookingId,
      occurredAt: now,
      payload: {
        booking_id: breach.bookingId,
        breach_id: breach.id,
        remedy_kind: breach.remedyKind,
        remedy_paise: fromPaiseBigint(breach.remedyPaise),
        payout_deduction_bps: breach.payoutDeductionBps,
        attributed_to: breach.attributedTo,
        staff_id: staffId,
      },
    });
    return { ...breach, appliedAt: now };
  }

  /** A breach is decided only while its remedy is neither applied nor waived. */
  private async lockOpen(tx: Tx, breachId: string): Promise<BreachRecord> {
    const breach = await this.breaches.lock(tx, breachId);
    if (!breach) throw new NotFoundException(BREACH_NOT_FOUND);
    if (breach.appliedAt !== null) {
      throw new ConflictException({
        code: 'BREACH_APPLIED',
        message: 'This breach remedy was already applied',
      });
    }
    if (breach.waivedBy !== null) {
      throw new ConflictException({ code: 'BREACH_WAIVED', message: 'This breach was waived' });
    }
    return breach;
  }

  /** Clocks whose breach owes nothing (waived, or put down to the client / force majeure). */
  private async settledClockIds(bookingIds: readonly string[]): Promise<Set<string>> {
    const all = await this.breaches.forBookings(this.sql, bookingIds);
    return new Set(all.filter((b) => !isOwed(b)).map((b) => b.clockId));
  }
}
