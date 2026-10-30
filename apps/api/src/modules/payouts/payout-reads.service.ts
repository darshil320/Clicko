import type {
  AdminPayoutBatchPage,
  AdminPayoutDuePayee,
  AdminPayoutsDue,
  PayoutBlocker,
  PayoutNotice,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import type { z } from 'zod';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import { payable } from './payout-assessment.service';
import { type BatchDetailWire, bankView, batchDetail, batchSummary, panView } from './payout-views';
import { PAYOUT_CONFIG } from './payouts.config';
import {
  BREACH_DEDUCTIONS,
  type BreachDeductionsPort,
  PAYEE_DIRECTORY,
  type PayeeDirectoryPort,
  type PayeeFacts,
} from './ports';
import { BatchesRepository } from './repositories/batches.repository';
import { DeductionsRepository } from './repositories/deductions.repository';
import { type PayoutRecord, PayoutsRepository } from './repositories/payouts.repository';
import { isIstMonday, istDate, nextIstWeekStart } from './rules/ist-calendar';
import { weeklyBatchRef } from './rules/references';
import { hasValidPan } from './rules/tds';

const DAY_MS = 86_400_000;
type DueWire = z.input<typeof AdminPayoutsDue>;
type PayeeWire = z.input<typeof AdminPayoutDuePayee>;
type PageWire = z.input<typeof AdminPayoutBatchPage>;

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const gross = (ps: readonly PayoutRecord[]): bigint => ps.reduce((s, p) => s + p.grossPaise, 0n);

const totals = (ps: readonly PayoutRecord[]) => ({
  payeeCount: unique(ps.map((p) => p.photographerId)).length,
  payoutCount: ps.length,
  grossPaise: gross(ps).toString(),
});

function blockers(payee: PayeeFacts | undefined): PayoutBlocker[] {
  if (!payee?.bank) return ['NO_BANK_ACCOUNT'];
  return payee.bank.verified ? [] : ['BANK_NOT_VERIFIED'];
}

/** The payouts desk's reads (ADR-0026 D3/D8). Never a full account number or PAN. */
@Injectable()
export class PayoutReadsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(PayoutsRepository) private readonly payouts: PayoutsRepository,
    @Inject(BatchesRepository) private readonly batches: BatchesRepository,
    @Inject(DeductionsRepository) private readonly deductions: DeductionsRepository,
    @Inject(PAYEE_DIRECTORY) private readonly directory: PayeeDirectoryPort,
    @Inject(BREACH_DEDUCTIONS) private readonly breaches: BreachDeductionsPort,
  ) {}

  async references(bookingIds: readonly string[]): Promise<Map<string, string>> {
    const facts = await this.bookings.adminFacts(unique(bookingIds));
    return new Map(facts.map((b) => [b.id, b.reference]));
  }

  async due(now: Date): Promise<DueWire> {
    const until = new Date(now.getTime() + PAYOUT_CONFIG.upcomingDays * DAY_MS);
    const [due, upcoming, draft] = await Promise.all([
      this.payouts.dueBy(this.sql, now),
      this.payouts.dueBetween(this.sql, now, until),
      this.batches.draft(this.sql),
    ]);
    const bookingIds = due.map((p) => p.bookingId);
    const [payees, refs, review] = await Promise.all([
      this.directory.payees(unique(due.map((p) => p.photographerId))),
      this.references(bookingIds),
      this.breaches.underReview(bookingIds),
    ]);
    const cities = await this.serviceability.cityNames(
      unique([...payees.values()].map((p) => p.cityId)),
    );
    const ready = due.filter((p) => payable(payees.get(p.photographerId)));
    const blocked = due.filter((p) => !payable(payees.get(p.photographerId)));
    const list = unique(due.map((p) => p.photographerId))
      .map((id) => this.payee(id, due, payees.get(id), refs, review, cities))
      .sort(
        (a, b) =>
          Number(a.blockers.length > 0) - Number(b.blockers.length > 0) ||
          a.name.localeCompare(b.name),
      );
    const weeklyRef = weeklyBatchRef(now);
    const weeklyOpen =
      isIstMonday(now) && !(await this.batches.referenceExists(this.sql, weeklyRef));
    return {
      asOf: now.toISOString(),
      ready: totals(ready),
      blocked: totals(blocked),
      upcoming: { ...totals(upcoming), until: until.toISOString() },
      draft: draft ? { id: draft.id, reference: draft.reference } : null,
      nextBatchKind: weeklyOpen ? 'WEEKLY' : 'OFF_CYCLE',
      nextWeeklyRunOn: weeklyOpen ? istDate(now) : istDate(nextIstWeekStart(now)),
      payees: list.slice(0, PAYOUT_CONFIG.maxDuePayees),
      truncated: list.length > PAYOUT_CONFIG.maxDuePayees,
    };
  }

  private payee(
    id: string,
    due: readonly PayoutRecord[],
    payee: PayeeFacts | undefined,
    refs: ReadonlyMap<string, string>,
    review: ReadonlySet<string>,
    cities: ReadonlyMap<string, string>,
  ): PayeeWire {
    const mine = due.filter((p) => p.photographerId === id);
    const lines = mine.map((p) => ({
      payoutId: p.id,
      bookingId: p.bookingId,
      bookingReference: refs.get(p.bookingId) ?? '—',
      eligibleAt: p.eligibleAt.toISOString(),
      grossPaise: fromPaiseBigint(p.grossPaise),
      breachUnderReview: review.has(p.bookingId),
    }));
    const notices: PayoutNotice[] = [
      ...(payee && hasValidPan({ pan: payee.pan, verified: payee.panVerified })
        ? []
        : (['NO_VALID_PAN'] as const)),
      ...(lines.some((l) => l.breachUnderReview) ? (['BREACH_UNDER_REVIEW'] as const) : []),
      ...(payee?.gstRegistered ? (['GST_REGISTERED'] as const) : []),
    ];
    return {
      photographerId: id,
      name: payee?.name ?? 'Unknown photographer',
      cityName: payee ? (cities.get(payee.cityId) ?? null) : null,
      bank: bankView(payee),
      pan: panView(payee),
      payoutCount: mine.length,
      grossPaise: fromPaiseBigint(gross(mine)),
      blockers: blockers(payee),
      notices,
      lines,
    };
  }

  async page(
    after: { readonly createdAt: Date; readonly id: string } | undefined,
    limit: number,
  ): Promise<{
    rows: PageWire['items'];
    last: { createdAt: Date; id: string } | null;
    more: boolean;
  }> {
    const rows = await this.batches.page(this.sql, after, limit + 1);
    const items = rows.slice(0, limit);
    const counts = await this.batches.counts(
      this.sql,
      items.map((b) => b.id),
    );
    const last = items.at(-1);
    return {
      rows: items.map((b) => batchSummary(b, counts.get(b.id))),
      last: last ? { createdAt: last.createdAt, id: last.id } : null,
      more: rows.length > limit,
    };
  }

  async detail(batchId: string): Promise<BatchDetailWire> {
    const batch = await this.batches.find(this.sql, batchId);
    if (!batch) {
      throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Payout batch not found' });
    }
    const payouts = await this.payouts.forBatch(this.sql, batchId);
    const ids = unique(payouts.map((p) => p.photographerId));
    const [counts, deductions, payees, broughtForward] = await Promise.all([
      this.batches.counts(this.sql, [batchId]),
      this.deductions.forPayouts(
        this.sql,
        payouts.map((p) => p.id),
      ),
      this.directory.payees(ids),
      this.payouts.carryIn(this.sql, ids, batch.exportedAt),
    ]);
    const references = await this.references([
      ...payouts.map((p) => p.bookingId),
      ...deductions.map((d) => d.bookingId),
    ]);
    return batchDetail({
      batch,
      counts: counts.get(batchId),
      payouts,
      deductions,
      payees,
      references,
      broughtForward,
    });
  }
}
