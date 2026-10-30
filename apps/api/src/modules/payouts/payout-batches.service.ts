import type { PayoutBatchKind } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { PayoutAssessmentService } from './payout-assessment.service';
import { PayoutLedger } from './payout-ledger';
import { BANK_FILE_PROVIDER, PAYOUT_CONFIG } from './payouts.config';
import { PAYEE_DIRECTORY, type PayeeDirectoryPort, type Tx } from './ports';
import { BatchesRepository, type BatchRecord } from './repositories/batches.repository';
import {
  DeductionsRepository,
  VendorInvoicesRepository,
} from './repositories/deductions.repository';
import { type PayoutRecord, PayoutsRepository } from './repositories/payouts.repository';
import { isIstMonday, istMonth } from './rules/ist-calendar';
import { offCycleBatchRef, offCyclePrefix, transferRef, weeklyBatchRef } from './rules/references';

/** The audit row for a batch, written in the change's own transaction (ADR-0025 D4). */
export type BatchAudit = (batchId: string) => TxHook;

const conflict = (code: string, message: string) => new ConflictException({ code, message });
const NOT_FOUND = { code: 'BATCH_NOT_FOUND', message: 'Payout batch not found' };
const sum = (ps: readonly PayoutRecord[], f: (p: PayoutRecord) => bigint): bigint =>
  ps.reduce((s, p) => s + f(p), 0n);
const n = fromPaiseBigint;

/**
 * Payout batches (ADR-0026 D3): a draft of everything due → export (amounts lock, vendor
 * invoices raised, ledger credited, the bank file can be downloaded) → each transfer marked paid
 * with the bank's UTR (or failed, and retried in a later bank file). One draft at a time.
 */
@Injectable()
export class PayoutBatchesService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(PayoutsRepository) private readonly payouts: PayoutsRepository,
    @Inject(BatchesRepository) private readonly batches: BatchesRepository,
    @Inject(DeductionsRepository) private readonly deductions: DeductionsRepository,
    @Inject(VendorInvoicesRepository) private readonly invoices: VendorInvoicesRepository,
    @Inject(PayoutAssessmentService) private readonly assessment: PayoutAssessmentService,
    @Inject(PayoutLedger) private readonly ledger: PayoutLedger,
    @Inject(PAYEE_DIRECTORY) private readonly directory: PayeeDirectoryPort,
  ) {}

  /** A draft of everything due now, for every photographer with a verified bank account. */
  async create(kind: PayoutBatchKind, now: Date, audit: BatchAudit): Promise<string> {
    return this.sql.begin(async (tx) => {
      await this.batches.lockDrafting(tx);
      const open = await this.batches.draft(tx);
      if (open) {
        throw conflict(
          'DRAFT_EXISTS',
          `Batch ${open.reference} is still a draft. Export or discard it first.`,
        );
      }
      const reference = await this.referenceFor(tx, kind, now);
      const plan = await this.assessment.plan(tx, await this.payouts.dueBy(tx, now), now);
      if (plan.payouts.length === 0) {
        throw conflict(
          'NOTHING_DUE',
          'Nothing can be paid right now: no payout is due, or everyone due is waiting on bank details.',
        );
      }
      if (plan.payeeCount > PAYOUT_CONFIG.maxTransfersPerBatch) {
        throw conflict('TOO_MANY_PAYEES', 'Too many photographers for one bank file.');
      }
      const batch = await this.batches.create(tx, reference, plan.totals, now);
      await this.payouts.assignToBatch(tx, batch.id, plan.payouts);
      await this.deductions.insert(tx, plan.deductions);
      await appendDomainEvent(tx, {
        eventType: 'payout_batch.created',
        aggregateKind: 'payout_batch',
        aggregateId: batch.id,
        occurredAt: now,
        payload: {
          batch_id: batch.id,
          reference,
          kind,
          payout_count: plan.totals.itemCount,
          net_paise: n(plan.totals.netPaise),
        },
      });
      await audit(batch.id)(tx, {
        before: null,
        after: {
          reference,
          kind,
          photographers: plan.payeeCount,
          payouts: plan.totals.itemCount,
          gross_paise: n(plan.totals.grossPaise),
          tds_paise: n(plan.totals.tdsPaise),
          net_paise: n(plan.totals.netPaise),
        },
      });
      return batch.id;
    });
  }

  private async referenceFor(tx: Tx, kind: PayoutBatchKind, now: Date): Promise<string> {
    if (kind === 'WEEKLY') {
      if (!isIstMonday(now)) {
        throw conflict('NOT_MONDAY', 'The weekly batch runs on Mondays. Make an off-cycle batch.');
      }
      const reference = weeklyBatchRef(now);
      if (await this.batches.referenceExists(tx, reference)) {
        throw conflict(
          'WEEKLY_BATCH_EXISTS',
          "This week's batch is already made. Make an off-cycle batch instead.",
        );
      }
      return reference;
    }
    return offCycleBatchRef(now, (await this.batches.countWithPrefix(tx, offCyclePrefix(now))) + 1);
  }

  /** Only a draft; its payouts are due again and nothing it assessed is kept. */
  async discard(batchId: string, now: Date, audit: BatchAudit): Promise<BatchRecord> {
    return this.sql.begin(async (tx) => {
      const batch = await this.lockBatch(tx, batchId);
      if (batch.status !== 'PENDING') {
        throw conflict('NOT_A_DRAFT', 'Only a draft batch can be discarded.');
      }
      await this.payouts.lockBatch(tx, batchId);
      const released = await this.payouts.release(tx, batchId);
      await this.batches.deleteDraft(tx, batchId);
      await appendDomainEvent(tx, {
        eventType: 'payout_batch.discarded',
        aggregateKind: 'payout_batch',
        aggregateId: batchId,
        occurredAt: now,
        payload: { batch_id: batchId, reference: batch.reference, payouts_released: released },
      });
      await audit(batchId)(tx, {
        before: { reference: batch.reference, status: 'DRAFT', net_paise: n(batch.netPaise) },
        after: { discarded: true, payouts_released: released },
      });
      return batch;
    });
  }

  /**
   * The credit (ADR-0026 D3): amounts lock, a vendor invoice per payout (self-billed unless the
   * photographer is GST-registered), the ledger postings, a payment reference per transfer.
   * A transfer with nothing left to pay is settled at once.
   */
  async export(batchId: string, staffId: string, now: Date, audit: BatchAudit): Promise<void> {
    await this.sql.begin(async (tx) => {
      const batch = await this.lockBatch(tx, batchId);
      if (batch.status !== 'PENDING') {
        throw conflict('ALREADY_EXPORTED', 'This batch was already exported.');
      }
      if (istMonth(batch.createdAt) !== istMonth(now)) {
        throw conflict(
          'BATCH_STALE',
          'This draft was made in an earlier month. Discard it and make a new batch, so TDS is worked out for this month.',
        );
      }
      await this.payouts.lockBatch(tx, batchId);
      const rows = await this.payouts.forBatch(tx, batchId);
      const ids = [...new Set(rows.map((p) => p.photographerId))];
      const [payees, deductions] = await Promise.all([
        this.directory.payees(ids),
        this.deductions.forPayouts(
          tx,
          rows.map((p) => p.id),
        ),
      ]);
      const order = [...ids].sort(
        (a, b) =>
          (payees.get(a)?.name ?? '').localeCompare(payees.get(b)?.name ?? '') ||
          a.localeCompare(b),
      );
      let line = 0;
      for (const id of order) {
        const mine = rows.filter((p) => p.photographerId === id);
        const payee = payees.get(id);
        const net = sum(mine, (p) => p.netPaise);
        if (
          net > 0n &&
          (!payee?.bank?.verified || payee.bank.accountId !== mine[0]?.bankAccountId)
        ) {
          throw conflict(
            'BANK_CHANGED',
            `${payee?.name ?? 'A photographer'}'s bank details changed since this draft. Discard it and make a new batch.`,
          );
        }
        for (const p of mine) {
          const invoiceId = await this.invoices.raise(tx, {
            photographerId: id,
            bookingId: p.bookingId,
            taxablePaise: p.grossPaise,
            selfBilled: !(payee?.gstRegistered ?? false),
            at: now,
          });
          await this.payouts.setVendorInvoice(tx, p.id, invoiceId);
          const recognised = deductions
            .filter((d) => d.payoutId === p.id)
            .reduce((s, d) => s + d.amountPaise, 0n);
          await this.ledger.credit(tx, p, recognised, batch.reference, now);
        }
        if (net > 0n) {
          line += 1;
          await this.payouts.markReady(
            tx,
            mine.map((p) => p.id),
            transferRef(batch.reference, line),
            BANK_FILE_PROVIDER,
          );
        } else {
          await this.payouts.markSettled(
            tx,
            mine.map((p) => p.id),
            now,
          );
          await appendDomainEvent(tx, {
            eventType: 'payout.transfer_settled',
            aggregateKind: 'photographer',
            aggregateId: id,
            occurredAt: now,
            payload: {
              batch_id: batchId,
              photographer_id: id,
              net_paise: 0,
              payout_ids: mine.map((p) => p.id),
            },
          });
        }
      }
      await this.batches.markExported(tx, batchId, staffId, now, line === 0);
      if (line === 0) {
        await appendDomainEvent(tx, {
          eventType: 'payout_batch.paid',
          aggregateKind: 'payout_batch',
          aggregateId: batchId,
          occurredAt: now,
          payload: { batch_id: batchId, reference: batch.reference },
        });
      }
      await appendDomainEvent(tx, {
        eventType: 'payout_batch.exported',
        aggregateKind: 'payout_batch',
        aggregateId: batchId,
        occurredAt: now,
        payload: {
          batch_id: batchId,
          reference: batch.reference,
          transfers: line,
          net_paise: n(batch.netPaise),
          tds_paise: n(batch.tdsPaise),
        },
      });
      await audit(batchId)(tx, {
        before: { status: 'DRAFT' },
        after: {
          status: line === 0 ? 'PAID' : 'EXPORTED',
          transfers: line,
          gross_paise: n(batch.grossPaise),
          tds_paise: n(batch.tdsPaise),
          net_paise: n(batch.netPaise),
        },
      });
    });
  }

  /** The bank confirmed these transfers: each payout PAID with its UTR, the cash leaves. */
  async markPaid(
    batchId: string,
    transfers: ReadonlyArray<{ readonly photographerId: string; readonly utr: string }>,
    now: Date,
    audit: BatchAudit,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      const batch = await this.exportedBatch(tx, batchId);
      const rows = await this.payouts.forBatch(tx, batchId);
      const done: Array<{ photographer_id: string; utr: string; net_paise: number }> = [];
      for (const t of transfers) {
        const mine = this.transfer(rows, t.photographerId);
        const status = mine[0]?.status;
        if (status === 'PAID') {
          if (mine.some((p) => p.utr === t.utr)) continue;
          if (mine.every((p) => p.utr === null)) {
            throw conflict('NOTHING_TO_PAY', 'Nothing was left to pay on this transfer.');
          }
          throw conflict('ALREADY_PAID', 'This transfer is already marked paid with another UTR.');
        }
        if (status === 'FAILED') {
          throw conflict(
            'TRANSFER_FAILED',
            'This transfer failed. Send it again before marking it paid.',
          );
        }
        if (status !== 'PROCESSING') {
          throw conflict('NOT_IN_BANK_FILE', 'Create the bank file with this transfer first.');
        }
        if (await this.payouts.utrUsedByOther(tx, t.utr, t.photographerId)) {
          throw conflict(
            'UTR_IN_USE',
            `UTR ${t.utr} is already recorded for another photographer.`,
          );
        }
        const ids = mine.map((p) => p.id);
        if ((await this.payouts.markPaid(tx, ids, t.utr, now)) !== ids.length) {
          throw conflict(
            'TRANSFER_CHANGED',
            'This transfer changed meanwhile. Reload and try again.',
          );
        }
        for (const p of mine) await this.ledger.paid(tx, p, t.utr, batch.reference, now);
        const net = sum(mine, (p) => p.netPaise);
        done.push({ photographer_id: t.photographerId, utr: t.utr, net_paise: n(net) });
        await appendDomainEvent(tx, {
          eventType: 'payout.transfer_paid',
          aggregateKind: 'photographer',
          aggregateId: t.photographerId,
          occurredAt: now,
          payload: {
            batch_id: batchId,
            photographer_id: t.photographerId,
            reference: mine[0]?.reference ?? null,
            utr: t.utr,
            net_paise: n(net),
            payout_ids: ids,
          },
        });
      }
      await this.closeIfSettled(tx, batch, now);
      if (done.length > 0) {
        await audit(batchId)(tx, { before: { paid: [] }, after: { paid: done } });
      }
    });
  }

  /** The bank returned a transfer: it waits, with its reason, until it is sent again. */
  async markFailed(
    batchId: string,
    photographerId: string,
    reason: string,
    now: Date,
    audit: BatchAudit,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.exportedBatch(tx, batchId);
      const mine = this.transfer(await this.payouts.forBatch(tx, batchId), photographerId);
      if (mine[0]?.status !== 'PROCESSING') {
        throw conflict('NOT_AWAITING', 'Only a transfer waiting for payment can be marked failed.');
      }
      await this.payouts.markFailed(
        tx,
        mine.map((p) => p.id),
        reason,
        now,
      );
      await appendDomainEvent(tx, {
        eventType: 'payout.transfer_failed',
        aggregateKind: 'photographer',
        aggregateId: photographerId,
        occurredAt: now,
        payload: { batch_id: batchId, photographer_id: photographerId, reason },
      });
      await audit(batchId)(tx, {
        before: { photographer_id: photographerId, state: 'AWAITING_PAYMENT' },
        after: { photographer_id: photographerId, state: 'FAILED', reason },
      });
    });
  }

  /** Send a failed transfer again (to the bank account now on file) in the next bank file. */
  async retry(
    batchId: string,
    photographerId: string,
    now: Date,
    audit: BatchAudit,
  ): Promise<void> {
    const payee = (await this.directory.payees([photographerId])).get(photographerId);
    const bank = payee?.bank;
    if (!bank?.verified) {
      throw conflict(
        'NO_VERIFIED_BANK',
        'Add and verify a bank account for this photographer before sending again.',
      );
    }
    await this.sql.begin(async (tx) => {
      await this.exportedBatch(tx, batchId);
      const mine = this.transfer(await this.payouts.forBatch(tx, batchId), photographerId);
      if (mine[0]?.status !== 'FAILED') {
        throw conflict('NOT_FAILED', 'Only a failed transfer can be sent again.');
      }
      await this.payouts.retry(
        tx,
        mine.map((p) => p.id),
        bank.accountId,
        retryReference(mine[0]?.reference ?? null),
      );
      await appendDomainEvent(tx, {
        eventType: 'payout.transfer_retried',
        aggregateKind: 'photographer',
        aggregateId: photographerId,
        occurredAt: now,
        payload: { batch_id: batchId, photographer_id: photographerId },
      });
      await audit(batchId)(tx, {
        before: { photographer_id: photographerId, state: 'FAILED' },
        after: { photographer_id: photographerId, state: 'READY_FOR_BANK_FILE' },
      });
    });
  }

  private transfer(rows: readonly PayoutRecord[], photographerId: string): PayoutRecord[] {
    const mine = rows.filter((p) => p.photographerId === photographerId);
    if (mine.length === 0) {
      throw new NotFoundException({
        code: 'TRANSFER_NOT_FOUND',
        message: 'That photographer is not in this batch',
      });
    }
    return mine;
  }

  private async lockBatch(tx: Tx, batchId: string): Promise<BatchRecord> {
    const batch = await this.batches.lock(tx, batchId);
    if (!batch) throw new NotFoundException(NOT_FOUND);
    return batch;
  }

  private async exportedBatch(tx: Tx, batchId: string): Promise<BatchRecord> {
    const batch = await this.lockBatch(tx, batchId);
    if (batch.status === 'PENDING') {
      throw conflict('NOT_EXPORTED', 'Export the bank file first.');
    }
    await this.payouts.lockBatch(tx, batchId);
    return batch;
  }

  private async closeIfSettled(tx: Tx, batch: BatchRecord, now: Date): Promise<void> {
    if (batch.status !== 'PROCESSING') return;
    const rows = await this.payouts.forBatch(tx, batch.id);
    if (rows.some((p) => p.status !== 'PAID')) return;
    await this.batches.markPaid(tx, batch.id, now);
    await appendDomainEvent(tx, {
      eventType: 'payout_batch.paid',
      aggregateKind: 'payout_batch',
      aggregateId: batch.id,
      occurredAt: now,
      payload: { batch_id: batch.id, reference: batch.reference },
    });
  }
}

/** PO20261214W001 → PO20261214W001R1 → …R2: a resent transfer never reuses a reference. */
export function retryReference(reference: string | null): string {
  if (!reference) throw new Error('a failed transfer has no reference');
  const m = /^(.*?)(?:R(\d+))?$/.exec(reference);
  const base = m?.[1] ?? reference;
  return `${base}R${Number(m?.[2] ?? 0) + 1}`;
}
