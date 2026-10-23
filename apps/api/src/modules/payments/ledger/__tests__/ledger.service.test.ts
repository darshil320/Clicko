import { describe, expect, it } from 'vitest';
import type { Tx } from '../../payments.types';
import { LedgerService } from '../ledger.service';
import { advanceCapturedEntries, LedgerImbalanceError } from '../ledger-entries';

const AT = new Date('2026-11-10T06:30:00.000Z');

/** A tagged-template stand-in for a postgres transaction that records each statement's values. */
function fakeTx() {
  const statements: unknown[][] = [];
  const tx = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(values);
    return Promise.resolve([]);
  }) as unknown as Tx;
  return { tx, statements };
}

describe('LedgerService.post', () => {
  it('writes one row per entry under a single new txn id', async () => {
    const { tx, statements } = fakeTx();
    const txnId = await new LedgerService().post(tx, {
      txnKind: 'ADVANCE_CAPTURED',
      entries: advanceCapturedEntries(845_411n),
      refs: { bookingId: 'b1', paymentId: 'p1', userId: 'u1' },
      memo: 'Advance captured',
      occurredAt: AT,
    });
    expect(txnId).toMatch(/^[0-9a-f-]{36}$/);
    expect(statements).toHaveLength(2);
    expect(statements.map((v) => v[0])).toEqual([txnId, txnId]);
    expect(statements.map((v) => [v[2], v[3], v[4]])).toEqual([
      ['CASH_GATEWAY', 'DEBIT', '845411'],
      ['CLIENT_RECEIVABLE', 'CREDIT', '845411'],
    ]);
  });

  it('refuses an unbalanced txn before touching the database', async () => {
    const { tx, statements } = fakeTx();
    await expect(
      new LedgerService().post(tx, {
        txnKind: 'ADVANCE_CAPTURED',
        entries: [
          { account: 'CASH_GATEWAY', direction: 'DEBIT', amountPaise: 100n },
          { account: 'CLIENT_RECEIVABLE', direction: 'CREDIT', amountPaise: 90n },
        ],
        refs: {},
        memo: 'broken',
        occurredAt: AT,
      }),
    ).rejects.toBeInstanceOf(LedgerImbalanceError);
    expect(statements).toHaveLength(0);
  });
});
