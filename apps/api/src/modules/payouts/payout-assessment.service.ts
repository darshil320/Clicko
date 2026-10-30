import { Inject, Injectable } from '@nestjs/common';
import { PAYOUT_CONFIG, TDS_RULES } from './payouts.config';
import {
  BREACH_DEDUCTIONS,
  type BreachDeductionsPort,
  type Db,
  PAYEE_DIRECTORY,
  type PayeeDirectoryPort,
  type PayeeFacts,
  PENALTY_DEDUCTIONS,
  type PenaltyDeductionsPort,
} from './ports';
import type { BatchTotals } from './repositories/batches.repository';
import { type DeductionRecord, DeductionsRepository } from './repositories/deductions.repository';
import {
  type PayoutAssessmentRow,
  type PayoutRecord,
  PayoutsRepository,
} from './repositories/payouts.repository';
import { type AssessDeduction, assessPayee, deductionAmount } from './rules/assess';
import { financialYearOf } from './rules/ist-calendar';
import { yearToDate } from './rules/tds';

const DAY_MS = 86_400_000;

export interface BatchPlan {
  readonly payouts: readonly PayoutAssessmentRow[];
  readonly deductions: readonly DeductionRecord[];
  readonly totals: BatchTotals;
  readonly payeeCount: number;
}

interface Candidate extends AssessDeduction {
  readonly photographerId: string;
  /** The payout the deduction's percentage was taken from. */
  readonly basisPayoutId: string;
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const keyOf = (photographerId: string, bookingId: string) => `${photographerId}:${bookingId}`;

/** A photographer can be paid once a verified primary bank account is on file. */
export const payable = (payee: PayeeFacts | undefined): boolean => payee?.bank?.verified === true;

/**
 * Works out a draft batch (ADR-0026 D3): for every photographer with a verified bank account,
 * their due payouts in order, the late-delivery and penalty deductions not yet recognised, what
 * earlier batches carried forward, and TDS against their financial year to date. Pure rules in
 * ./rules; this service only gathers the facts.
 */
@Injectable()
export class PayoutAssessmentService {
  constructor(
    @Inject(PayoutsRepository) private readonly payouts: PayoutsRepository,
    @Inject(DeductionsRepository) private readonly deductions: DeductionsRepository,
    @Inject(PAYEE_DIRECTORY) private readonly directory: PayeeDirectoryPort,
    @Inject(PENALTY_DEDUCTIONS) private readonly penalties: PenaltyDeductionsPort,
    @Inject(BREACH_DEDUCTIONS) private readonly breaches: BreachDeductionsPort,
  ) {}

  async plan(db: Db, due: readonly PayoutRecord[], now: Date): Promise<BatchPlan> {
    const payees = await this.directory.payees(unique(due.map((p) => p.photographerId)));
    const included = due.filter((p) => payable(payees.get(p.photographerId)));
    const ids = unique(included.map((p) => p.photographerId)).sort();
    if (ids.length === 0) {
      return {
        payouts: [],
        deductions: [],
        payeeCount: 0,
        totals: { grossPaise: 0n, tdsPaise: 0n, netPaise: 0n, itemCount: 0 },
      };
    }
    const since = new Date(now.getTime() - PAYOUT_CONFIG.deductionLookbackDays * DAY_MS);
    const [candidates, credited, carry] = await Promise.all([
      this.candidates(db, ids, included, since),
      this.payouts.creditedSince(db, ids, financialYearOf(now).start),
      this.payouts.carryIn(db, ids, null),
    ]);

    const rows: PayoutAssessmentRow[] = [];
    const recognised: DeductionRecord[] = [];
    for (const id of ids) {
      const payee = payees.get(id);
      const bank = payee?.bank;
      if (!payee || !bank) continue;
      const mine = included.filter((p) => p.photographerId === id);
      const myDeductions = candidates.filter((c) => c.photographerId === id);
      const assessed = assessPayee({
        payouts: mine.map((p) => ({
          payoutId: p.id,
          bookingId: p.bookingId,
          grossPaise: p.grossPaise,
        })),
        deductions: myDeductions,
        carryInPaise: (carry.get(id) ?? 0n) > 0n ? (carry.get(id) ?? 0n) : 0n,
        ytd: yearToDate(
          credited
            .filter((c) => c.photographerId === id && c.creditedAt !== null)
            .map((c) => ({
              grossPaise: c.grossPaise,
              basePaise: c.tdsBasePaise,
              creditedAt: c.creditedAt as Date,
            })),
          now,
        ),
        pan: { pan: payee.pan, verified: payee.panVerified },
        rules: TDS_RULES,
      });
      for (const a of assessed.payouts) {
        rows.push({
          payoutId: a.payoutId,
          bankAccountId: bank.accountId,
          tdsSection: a.tds.section,
          tdsRateBps: a.tds.rateBps,
          tdsPaise: a.tds.tdsPaise,
          tdsBasePaise: a.tds.basePaise,
          penaltyPaise: a.penaltyPaise,
          otherPaise: a.otherPaise,
          netPaise: a.netPaise,
        });
      }
      const inBatch = new Set(mine.map((p) => p.id));
      const first = mine[0]?.id;
      for (const c of myDeductions) {
        const payoutId = inBatch.has(c.basisPayoutId) ? c.basisPayoutId : first;
        if (!payoutId) continue;
        recognised.push({
          payoutId,
          photographerId: id,
          bookingId: c.bookingId,
          sourceKind: c.sourceKind,
          sourceId: c.sourceId,
          basisPaise: c.basisPaise,
          rateBps: c.rateBps,
          amountPaise: c.amountPaise,
        });
      }
    }
    const totals = rows.reduce(
      (t, r) => {
        const gross = included.find((p) => p.id === r.payoutId)?.grossPaise ?? 0n;
        return {
          grossPaise: t.grossPaise + gross,
          tdsPaise: t.tdsPaise + r.tdsPaise,
          netPaise: t.netPaise + r.netPaise,
          itemCount: t.itemCount + 1,
        };
      },
      { grossPaise: 0n, tdsPaise: 0n, netPaise: 0n, itemCount: 0 },
    );
    return { payouts: rows, deductions: recognised, totals, payeeCount: ids.length };
  }

  /**
   * Deductions not yet recognised whose booking payout is credited already or in this batch:
   * applied photographer-attributed breaches (ADR-0016 D9 percentages) and un-waived penalties.
   */
  private async candidates(
    db: Db,
    ids: readonly string[],
    included: readonly PayoutRecord[],
    since: Date,
  ): Promise<Candidate[]> {
    const inBatch = new Set(included.map((p) => p.id));
    const recent = await this.payouts.recentFor(db, ids, since);
    const bases = [...new Map([...recent, ...included].map((p) => [p.id, p])).values()].filter(
      (p) => p.creditedAt !== null || inBatch.has(p.id),
    );
    const byKey = new Map(bases.map((p) => [keyOf(p.photographerId, p.bookingId), p]));
    const [applied, penalties] = await Promise.all([
      this.breaches.applied(unique(bases.map((p) => p.bookingId))),
      this.penalties.unwaived(ids),
    ]);
    const done = await this.deductions.recognised(db, [
      ...applied.map((b) => b.breachId),
      ...penalties.map((p) => p.penaltyId),
    ]);
    const fromBreaches = applied
      .filter((b) => !done.has(b.breachId))
      .flatMap((b) => {
        // One payout per delivered booking (the completed assignment): one deduction per breach.
        const basis = bases.find((p) => p.bookingId === b.bookingId);
        return basis ? [candidate(basis, 'SLA_BREACH', b.breachId, b.payoutDeductionBps)] : [];
      });
    const fromPenalties = penalties
      .filter((p) => !done.has(p.penaltyId))
      .flatMap((pen) => {
        const basis = byKey.get(keyOf(pen.photographerId, pen.bookingId));
        return basis ? [candidate(basis, 'PENALTY', pen.penaltyId, pen.payoutDeductionBps)] : [];
      });
    return [...fromBreaches, ...fromPenalties].filter((c) => c.amountPaise > 0n);
  }
}

function candidate(
  basis: PayoutRecord,
  sourceKind: Candidate['sourceKind'],
  sourceId: string,
  rateBps: number,
): Candidate {
  return {
    photographerId: basis.photographerId,
    basisPayoutId: basis.id,
    sourceKind,
    sourceId,
    bookingId: basis.bookingId,
    basisPaise: basis.grossPaise,
    rateBps,
    amountPaise: deductionAmount(basis.grossPaise, rateBps),
  };
}
