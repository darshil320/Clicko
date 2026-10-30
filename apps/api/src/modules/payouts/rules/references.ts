/**
 * Batch and transfer references (pure). Letters and digits only, short enough for any Indian
 * bank's bulk-upload "payment reference" column:
 *   weekly    PO20261102W     (the Monday, IST)
 *   off-cycle PO20261104X1, X2 …
 *   transfer  PO20261102W007  (batch + three-digit line)
 */
import type { PayoutBatchKind } from '@clickco/contracts';
import { PAYOUT_CONFIG } from '../payouts.config';
import { istDate } from './ist-calendar';

const compactDay = (at: Date): string => istDate(at).replaceAll('-', '');

export function weeklyBatchRef(at: Date): string {
  return `PO${compactDay(at)}W`;
}

export function offCycleBatchRef(at: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError('bad sequence');
  return `PO${compactDay(at)}X${sequence}`;
}

/** The common prefix of a day's off-cycle references. */
export function offCyclePrefix(at: Date): string {
  return `PO${compactDay(at)}X`;
}

const BATCH_REF = /^PO(\d{4})(\d{2})(\d{2})(W|X\d{1,3})$/;

export function parseBatchRef(ref: string): { kind: PayoutBatchKind; day: string } {
  const m = BATCH_REF.exec(ref);
  if (!m) throw new RangeError(`not a batch reference: ${ref}`);
  return { kind: m[4] === 'W' ? 'WEEKLY' : 'OFF_CYCLE', day: `${m[1]}-${m[2]}-${m[3]}` };
}

export function transferRef(batchRef: string, line: number): string {
  if (!Number.isInteger(line) || line < 1 || line > PAYOUT_CONFIG.maxTransfersPerBatch) {
    throw new RangeError(`transfer line out of range: ${line}`);
  }
  return `${batchRef}${String(line).padStart(3, '0')}`;
}
