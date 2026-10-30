import { Inject, Injectable } from '@nestjs/common';
import { LedgerService } from '../payments/ledger/ledger.service';
import type { LedgerLine, TxnKind } from '../payments/ledger/ledger-entries';
import type { Tx } from './ports';
import type { PayoutRecord } from './repositories/payouts.repository';
import {
  payoutAccruedEntries,
  payoutDeductionEntries,
  payoutPaidEntries,
  tdsWithheldEntries,
} from './rules/ledger-postings';

/**
 * Writes a payout's postings through LedgerService (append-only, balanced per txn, with the
 * payout and photographer on every line). Postings come from ./rules/ledger-postings.
 */
@Injectable()
export class PayoutLedger {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}

  private async post(
    tx: Tx,
    p: PayoutRecord,
    txnKind: TxnKind,
    entries: readonly LedgerLine[],
    memo: string,
    at: Date,
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.ledger.post(tx, {
      txnKind,
      entries,
      refs: { bookingId: p.bookingId, payoutId: p.id, photographerId: p.photographerId },
      memo,
      occurredAt: at,
    });
  }

  /** At export: the vendor invoice, TDS withheld, deductions recognised and recovered. */
  async credit(
    tx: Tx,
    p: PayoutRecord,
    recognisedPaise: bigint,
    batchRef: string,
    at: Date,
  ): Promise<void> {
    await this.post(tx, p, 'PAYOUT_ACCRUED', payoutAccruedEntries(p.grossPaise), batchRef, at);
    await this.post(
      tx,
      p,
      'TDS_WITHHELD',
      tdsWithheldEntries(p.tdsPaise),
      `${batchRef} s.${p.tdsSection ?? '-'} ${p.tdsRateBps} bps`,
      at,
    );
    await this.post(
      tx,
      p,
      'PAYOUT_DEDUCTION',
      payoutDeductionEntries(recognisedPaise, p.penaltyDeductionPaise + p.otherDeductionPaise),
      batchRef,
      at,
    );
  }

  /** The bank confirmed the transfer. */
  async paid(tx: Tx, p: PayoutRecord, utr: string, batchRef: string, at: Date): Promise<void> {
    await this.post(
      tx,
      p,
      'PAYOUT_PAID',
      payoutPaidEntries(p.netPaise),
      `${batchRef} UTR ${utr}`,
      at,
    );
  }
}
