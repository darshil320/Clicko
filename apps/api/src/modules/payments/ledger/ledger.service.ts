import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Tx } from '../payments.types';
import { assertBalanced, type LedgerLine, type TxnKind } from './ledger-entries';

const pg = (paise: bigint): string => paise.toString();

export interface LedgerRefs {
  readonly bookingId?: string;
  readonly paymentId?: string;
  readonly userId?: string;
  readonly refundId?: string;
  readonly payoutId?: string;
  readonly photographerId?: string;
}

export interface LedgerTxn {
  readonly txnKind: TxnKind;
  readonly entries: readonly LedgerLine[];
  readonly refs: LedgerRefs;
  readonly memo: string;
  readonly occurredAt: Date;
}

/**
 * Append-only double-entry ledger (DOMAIN §5 rule 8). The app refuses an unbalanced txn before
 * inserting; the deferred ledger_must_balance trigger is the guarantee at commit. INSERT only.
 */
@Injectable()
export class LedgerService {
  async post(tx: Tx, txn: LedgerTxn): Promise<string> {
    assertBalanced(txn.entries);
    const txnId = randomUUID();
    for (const line of txn.entries) {
      await tx`
        INSERT INTO ledger_entries (txn_id, txn_kind, account, direction, amount_paise,
                                    booking_id, payment_id, user_id, refund_id, payout_id,
                                    photographer_id, memo, occurred_at)
        VALUES (${txnId}, ${txn.txnKind}, ${line.account}, ${line.direction}, ${pg(line.amountPaise)},
                ${txn.refs.bookingId ?? null}, ${txn.refs.paymentId ?? null},
                ${txn.refs.userId ?? null}, ${txn.refs.refundId ?? null},
                ${txn.refs.payoutId ?? null}, ${txn.refs.photographerId ?? null},
                ${txn.memo}, ${txn.occurredAt})`;
    }
    return txnId;
  }
}
