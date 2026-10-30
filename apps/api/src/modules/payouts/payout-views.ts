import type {
  AdminPayoutBatchDetail,
  AdminPayoutBatchSummary,
  AdminPayoutDeduction,
  AdminPayoutLine,
  AdminPayoutTransfer,
  PayoutBankView,
  PayoutBatchState,
  PayoutPanView,
  PayoutTransferState,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import type { z } from 'zod';
import type { PayeeFacts } from './ports';
import type { BatchCounts, BatchRecord } from './repositories/batches.repository';
import type { DeductionRecord } from './repositories/deductions.repository';
import type { PayoutRecord } from './repositories/payouts.repository';
import { maskPan } from './rules/masking';
import { parseBatchRef } from './rules/references';
import { hasValidPan } from './rules/tds';

/** Wire (input) shapes: aggregates are decimal strings (ADR-0007). */
export type BatchSummaryWire = z.input<typeof AdminPayoutBatchSummary>;
export type BatchDetailWire = z.input<typeof AdminPayoutBatchDetail>;
type TransferWire = z.input<typeof AdminPayoutTransfer>;
type LineWire = z.input<typeof AdminPayoutLine>;
type DeductionWire = z.input<typeof AdminPayoutDeduction>;

const n = fromPaiseBigint;
const sum = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);

export function bankView(payee: PayeeFacts | undefined): PayoutBankView | null {
  const b = payee?.bank;
  if (!b) return null;
  return {
    holder: b.holder,
    bankName: b.bankName,
    ifsc: b.ifsc,
    last4: b.last4,
    verified: b.verified,
  };
}

export function panView(payee: PayeeFacts | undefined): PayoutPanView {
  if (!payee) return { masked: null, valid: false };
  return {
    masked: maskPan(payee.pan),
    valid: hasValidPan({ pan: payee.pan, verified: payee.panVerified }),
  };
}

export function batchState(batch: BatchRecord, counts: BatchCounts | undefined): PayoutBatchState {
  if (batch.status === 'PENDING') return 'DRAFT';
  if (batch.status === 'PAID') return 'PAID';
  return (counts?.paid ?? 0) > 0 ? 'PARTIALLY_PAID' : 'EXPORTED';
}

export function batchSummary(
  batch: BatchRecord,
  counts: BatchCounts | undefined,
): BatchSummaryWire {
  return {
    id: batch.id,
    reference: batch.reference,
    kind: parseBatchRef(batch.reference).kind,
    state: batchState(batch, counts),
    createdAt: batch.createdAt.toISOString(),
    cutoffAt: batch.createdAt.toISOString(),
    exportedAt: batch.exportedAt?.toISOString() ?? null,
    paidAt: batch.paidAt?.toISOString() ?? null,
    payeeCount: counts?.payees ?? 0,
    payoutCount: batch.itemCount,
    transfersReady: counts?.ready ?? 0,
    transfersAwaiting: counts?.awaiting ?? 0,
    transfersPaid: counts?.paid ?? 0,
    transfersFailed: counts?.failed ?? 0,
    grossPaise: batch.grossPaise.toString(),
    deductionsPaise: (batch.grossPaise - batch.tdsPaise - batch.netPaise).toString(),
    tdsPaise: batch.tdsPaise.toString(),
    netPaise: batch.netPaise.toString(),
  };
}

function transferState(batch: BatchRecord, payouts: readonly PayoutRecord[]): PayoutTransferState {
  if (batch.status === 'PENDING') return 'IN_DRAFT';
  const status = payouts[0]?.status;
  if (status === 'FAILED') return 'FAILED';
  if (status === 'APPROVED') return 'READY_FOR_BANK_FILE';
  if (status === 'PROCESSING') return 'AWAITING_PAYMENT';
  return payouts.some((p) => p.utr !== null) ? 'PAID' : 'NOTHING_TO_PAY';
}

export interface DetailFacts {
  readonly batch: BatchRecord;
  readonly counts: BatchCounts | undefined;
  readonly payouts: readonly PayoutRecord[];
  readonly deductions: readonly DeductionRecord[];
  readonly payees: ReadonlyMap<string, PayeeFacts>;
  readonly references: ReadonlyMap<string, string>;
  /** Owed per photographer from batches credited before this one. */
  readonly broughtForward: ReadonlyMap<string, bigint>;
}

const line = (p: PayoutRecord, refs: ReadonlyMap<string, string>): LineWire => ({
  payoutId: p.id,
  bookingId: p.bookingId,
  bookingReference: refs.get(p.bookingId) ?? '—',
  eligibleAt: p.eligibleAt.toISOString(),
  grossPaise: n(p.grossPaise),
  tdsSection: p.tdsSection,
  tdsRateBps: p.tdsRateBps,
  tdsPaise: n(p.tdsPaise),
  penaltyDeductionPaise: n(p.penaltyDeductionPaise),
  otherDeductionPaise: n(p.otherDeductionPaise),
  netPaise: n(p.netPaise),
});

const deduction = (d: DeductionRecord, refs: ReadonlyMap<string, string>): DeductionWire => ({
  kind: d.sourceKind === 'SLA_BREACH' ? 'LATE_DELIVERY' : 'PENALTY',
  bookingReference: refs.get(d.bookingId) ?? '—',
  rateBps: d.rateBps,
  basisPaise: n(d.basisPaise),
  amountPaise: n(d.amountPaise),
});

/** One transfer per photographer; ordered by reference (export order), then name. */
export function transfers(f: DetailFacts): TransferWire[] {
  const ids = [...new Set(f.payouts.map((p) => p.photographerId))];
  const list = ids.map((id): TransferWire => {
    const mine = f.payouts.filter((p) => p.photographerId === id);
    const mineIds = new Set(mine.map((p) => p.id));
    const recognised = f.deductions.filter((d) => mineIds.has(d.payoutId));
    const applied = sum(mine.map((p) => p.penaltyDeductionPaise + p.otherDeductionPaise));
    const brought = f.broughtForward.get(id) ?? 0n;
    const broughtForward = brought > 0n ? brought : 0n;
    const carried = broughtForward + sum(recognised.map((d) => d.amountPaise)) - applied;
    const payee = f.payees.get(id);
    const settled = mine.find((p) => p.utr !== null || p.paidAt !== null);
    return {
      photographerId: id,
      name: payee?.name ?? 'Unknown photographer',
      reference: mine[0]?.reference ?? null,
      state: transferState(f.batch, mine),
      bank: bankView(payee),
      pan: panView(payee),
      grossPaise: n(sum(mine.map((p) => p.grossPaise))),
      deductionsPaise: n(applied),
      tdsPaise: n(sum(mine.map((p) => p.tdsPaise))),
      netPaise: n(sum(mine.map((p) => p.netPaise))),
      broughtForwardPaise: n(broughtForward),
      carriedForwardPaise: n(carried > 0n ? carried : 0n),
      utr: settled?.utr ?? null,
      paidAt: settled?.paidAt?.toISOString() ?? null,
      failureReason: mine[0]?.failureReason ?? null,
      lines: mine.map((p) => line(p, f.references)),
      deductions: recognised.map((d) => deduction(d, f.references)),
    };
  });
  return list.sort(
    (a, b) =>
      (a.reference ?? '~').localeCompare(b.reference ?? '~') || a.name.localeCompare(b.name),
  );
}

export function batchDetail(f: DetailFacts): BatchDetailWire {
  return { ...batchSummary(f.batch, f.counts), transfers: transfers(f) };
}
