import { Inject, Injectable } from '@nestjs/common';
import { invoiceSeriesFor } from './financial-year';
import { type InvoiceSplit, remainderInvoice, splitInvoice } from './invoice-split';
import { LedgerService } from './ledger/ledger.service';
import { gstAccruedEntries, travelShareOf } from './ledger/ledger-entries';
import type { InvoiceBasis, PaymentPurpose, Tx } from './payments.types';
import { InvoicesRepository } from './repositories/invoices.repository';

export interface IssueInvoiceInput {
  readonly bookingId: string;
  readonly userId: string;
  readonly paymentId: string;
  readonly purpose: PaymentPurpose;
  readonly amountPaise: bigint;
  readonly basis: InvoiceBasis;
  readonly issuedAt: Date;
}

export interface IssuedInvoice extends InvoiceSplit {
  readonly id: string;
  readonly invoiceNumber: string;
}

/**
 * GST tax invoices (doc 05 §9). Issuing one allocates the next gapless number for the FY series
 * and recognises revenue + output GST in the ledger (GST_ACCRUED), all in the caller's tx.
 */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(InvoicesRepository) private readonly repo: InvoicesRepository,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async issue(tx: Tx, i: IssueInvoiceInput): Promise<IssuedInvoice> {
    const split = splitInvoice({
      amountPaise: i.amountPaise,
      snapshot: i.basis,
      placeOfSupply: i.basis.placeOfSupply,
    });
    return this.issueSplit(tx, i, split);
  }

  /**
   * ADR-0016 D3: the balance invoice — what is left of every snapshot after the invoices already
   * issued, so a booking's invoices sum to its snapshots to the paisa. `basis` = all snapshots.
   */
  async issueRemainder(tx: Tx, i: Omit<IssueInvoiceInput, 'amountPaise'>): Promise<IssuedInvoice> {
    const prior = await this.repo.forBooking(tx, i.bookingId);
    const split = remainderInvoice({
      snapshot: i.basis,
      placeOfSupply: i.basis.placeOfSupply,
      prior,
    });
    return this.issueSplit(tx, { ...i, amountPaise: split.totalPaise }, split);
  }

  private async issueSplit(
    tx: Tx,
    i: IssueInvoiceInput,
    split: InvoiceSplit,
  ): Promise<IssuedInvoice> {
    const series = invoiceSeriesFor(i.issuedAt);
    await this.repo.ensureSeries(tx, series);
    const invoiceNumber = await this.repo.allocateNumber(tx, series.code, series.financialYear);
    const id = await this.repo.insert(tx, {
      ...split,
      invoiceNumber,
      bookingId: i.bookingId,
      userId: i.userId,
      purpose: i.purpose,
      sacCode: i.basis.sacCode,
      placeOfSupply: i.basis.placeOfSupply,
      issuedAt: i.issuedAt,
    });
    await this.ledger.post(tx, {
      txnKind: 'GST_ACCRUED',
      entries: gstAccruedEntries({
        invoiceTotalPaise: split.totalPaise,
        taxablePaise: split.taxablePaise,
        travelSharePaise: travelShareOf(split.taxablePaise, i.basis),
      }),
      refs: { bookingId: i.bookingId, paymentId: i.paymentId, userId: i.userId },
      memo: `Invoice ${invoiceNumber}`,
      occurredAt: i.issuedAt,
    });
    return { ...split, id, invoiceNumber };
  }
}
