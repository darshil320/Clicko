import type { PayoutBasis, ProPaidTransfer, ProPayoutStatus } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import { PAYOUT_CONFIG } from './payouts.config';
import { type PayoutStatus, PayoutsRepository } from './repositories/payouts.repository';

/** Paid transfers shown in the Pro app, newest first. */
const MAX_PAID_TRANSFERS = 20;
/** Payout rows read for the earnings (the same horizon as the jobs scanned). */
const MAX_PAYOUTS = 2_000;
const UTR_VISIBLE_CHARS = 4;
const DAY_MS = 86_400_000;

const PRO_STATUS: Readonly<Record<PayoutStatus, ProPayoutStatus>> = {
  PENDING: 'DUE',
  APPROVED: 'IN_PAYMENT',
  PROCESSING: 'IN_PAYMENT',
  // The bank returned it; finance sends it again (ADR-0026 D3).
  FAILED: 'IN_PAYMENT',
  PAID: 'PAID',
  WITHHELD: 'WITHHELD',
};

/** One of the photographer's payouts as the Pro app may know it. */
export interface ProPayoutFact {
  readonly status: ProPayoutStatus;
  readonly basis: PayoutBasis;
  /** What it pays: its gross, 0 while withheld. */
  readonly payingPaise: bigint;
  /** When the shoot's outcome happened (delivery, confirmation, check-out): due date − 3 days. */
  readonly outcomeAt: Date;
}

export interface ProPayoutFacts {
  readonly paidTransfers: readonly ProPaidTransfer[];
  /** By booking. */
  readonly payouts: ReadonlyMap<string, ProPayoutFact>;
}

/**
 * What the Pro app may know about a photographer's own payouts (ADR-0027 D5). Owned here so the
 * on-site earnings never read the payouts tables. Only a UTR's last 4 characters leave this
 * reader; never a bank account, a PAN or a full UTR.
 */
@Injectable()
export class ProPayoutsReader {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(PayoutsRepository) private readonly payouts: PayoutsRepository,
  ) {}

  async forPhotographer(photographerId: string): Promise<ProPayoutFacts> {
    const [transfers, rows] = await Promise.all([
      this.payouts.paidTransfers(this.sql, photographerId, MAX_PAID_TRANSFERS),
      this.payouts.forPhotographer(this.sql, photographerId, MAX_PAYOUTS),
    ]);
    const delayMs = PAYOUT_CONFIG.daysAfterDelivery * DAY_MS;
    return {
      paidTransfers: transfers.map((t) => ({
        batchReference: t.batchReference,
        paidAt: t.paidAt.toISOString(),
        payoutCount: t.payoutCount,
        grossPaise: fromPaiseBigint(t.grossPaise),
        deductionsPaise: fromPaiseBigint(t.deductionsPaise),
        tdsPaise: fromPaiseBigint(t.tdsPaise),
        netPaise: fromPaiseBigint(t.netPaise),
        utrLast4: t.utr ? t.utr.slice(-UTR_VISIBLE_CHARS) : null,
      })),
      payouts: new Map(
        rows.map((r) => [
          r.bookingId,
          {
            status: PRO_STATUS[r.status],
            basis: r.basis,
            payingPaise: r.status === 'WITHHELD' ? 0n : r.grossPaise,
            outcomeAt: new Date(r.eligibleAt.getTime() - delayMs),
          },
        ]),
      ),
    };
  }
}
