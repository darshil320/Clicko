import { Injectable } from '@nestjs/common';
import type { InvoiceSeriesKey } from '../financial-year';
import type { InvoiceSplit } from '../invoice-split';
import type { Db, Tx } from '../payments.types';
import type { CreditNoteRecord, InvoiceForCredit } from '../refunds.types';

const pg = (paise: bigint): string => paise.toString();

interface InvoiceRow {
  id: string;
  invoice_number: string;
  booking_id: string;
  user_id: string;
  taxable_amount_paise: string;
  cgst_paise: string;
  sgst_paise: string;
  igst_paise: string;
  total_amount_paise: string;
  sac_code: string;
  place_of_supply: string;
  issued_at: Date;
  cancelled_at: Date | null;
}

interface NoteRow {
  id: string;
  credit_note_number: string;
  invoice_id: string;
  invoice_number: string;
  refund_id: string | null;
  taxable_amount_paise: string;
  cgst_paise: string;
  sgst_paise: string;
  igst_paise: string;
  total_amount_paise: string;
  issued_at: Date;
  late_for_gst: boolean;
}

const toNote = (r: NoteRow): CreditNoteRecord => ({
  id: r.id,
  number: r.credit_note_number,
  invoiceId: r.invoice_id,
  invoiceNumber: r.invoice_number,
  refundId: r.refund_id,
  taxablePaise: BigInt(r.taxable_amount_paise),
  cgstPaise: BigInt(r.cgst_paise),
  sgstPaise: BigInt(r.sgst_paise),
  igstPaise: BigInt(r.igst_paise),
  totalPaise: BigInt(r.total_amount_paise),
  issuedAt: r.issued_at,
  lateForGst: r.late_for_gst,
});

export interface NewCreditNote extends InvoiceSplit {
  readonly number: string;
  readonly financialYear: string;
  readonly invoice: InvoiceForCredit;
  readonly refundId: string;
  readonly reasonCode: string;
  readonly issuedAt: Date;
  readonly lateForGst: boolean;
}

const NOTE_SELECT = `n.id, n.credit_note_number, n.invoice_id, i.invoice_number, n.refund_id,
  n.taxable_amount_paise, n.cgst_paise, n.sgst_paise, n.igst_paise, n.total_amount_paise,
  n.issued_at, n.late_for_gst`;

/** credit_notes (addendum 0005) and the invoice facts a credit note needs. Insert-only. */
@Injectable()
export class CreditNotesRepository {
  async lockInvoice(tx: Tx, id: string): Promise<InvoiceForCredit | null> {
    const [r] = await tx<InvoiceRow[]>`
      SELECT id, invoice_number, booking_id, user_id, taxable_amount_paise, cgst_paise, sgst_paise,
             igst_paise, total_amount_paise, sac_code, place_of_supply, issued_at, cancelled_at
      FROM invoices WHERE id = ${id} FOR UPDATE`;
    if (!r) return null;
    return {
      id: r.id,
      invoiceNumber: r.invoice_number,
      bookingId: r.booking_id,
      userId: r.user_id,
      taxablePaise: BigInt(r.taxable_amount_paise),
      cgstPaise: BigInt(r.cgst_paise),
      sgstPaise: BigInt(r.sgst_paise),
      igstPaise: BigInt(r.igst_paise),
      totalPaise: BigInt(r.total_amount_paise),
      sacCode: r.sac_code,
      placeOfSupply: r.place_of_supply,
      issuedAt: r.issued_at,
      cancelled: r.cancelled_at !== null,
    };
  }

  /** What every credit note so far took off this invoice. */
  async creditedSoFar(db: Db, invoiceId: string): Promise<InvoiceSplit> {
    const [r] = await db<{ t: string; c: string; s: string; i: string; total: string }[]>`
      SELECT coalesce(sum(taxable_amount_paise), 0) AS t, coalesce(sum(cgst_paise), 0) AS c,
             coalesce(sum(sgst_paise), 0) AS s, coalesce(sum(igst_paise), 0) AS i,
             coalesce(sum(total_amount_paise), 0) AS total
      FROM credit_notes WHERE invoice_id = ${invoiceId}`;
    return {
      taxablePaise: BigInt(r?.t ?? 0),
      cgstPaise: BigInt(r?.c ?? 0),
      sgstPaise: BigInt(r?.s ?? 0),
      igstPaise: BigInt(r?.i ?? 0),
      totalPaise: BigInt(r?.total ?? 0),
    };
  }

  /** The next gapless number of the CLK-CN series for the FY (a rollback leaves no gap). */
  async allocateNumber(tx: Tx, s: InvoiceSeriesKey): Promise<number> {
    await tx`
      INSERT INTO invoice_series (code, financial_year, prefix)
      VALUES (${s.code}, ${s.financialYear}, ${s.prefix})
      ON CONFLICT (code, financial_year) DO NOTHING`;
    const [row] = await tx<{ last_number: number }[]>`
      UPDATE invoice_series SET last_number = last_number + 1
      WHERE code = ${s.code} AND financial_year = ${s.financialYear} AND is_active
      RETURNING last_number`;
    if (!row) throw new Error(`No active credit note series for FY ${s.financialYear}`);
    return row.last_number;
  }

  async insert(tx: Tx, n: NewCreditNote): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO credit_notes (credit_note_number, financial_year, invoice_id, booking_id, user_id,
                                refund_id, reason_code, taxable_amount_paise, cgst_paise, sgst_paise,
                                igst_paise, total_amount_paise, sac_code, place_of_supply, issued_at,
                                late_for_gst)
      VALUES (${n.number}, ${n.financialYear}, ${n.invoice.id}, ${n.invoice.bookingId},
              ${n.invoice.userId}, ${n.refundId}, ${n.reasonCode}, ${pg(n.taxablePaise)},
              ${pg(n.cgstPaise)}, ${pg(n.sgstPaise)}, ${pg(n.igstPaise)}, ${pg(n.totalPaise)},
              ${n.invoice.sacCode}, ${n.invoice.placeOfSupply}, ${n.issuedAt}, ${n.lateForGst})
      RETURNING id`;
    if (!row) throw new Error('credit_notes.insert: no row returned');
    return row.id;
  }

  async forRefunds(db: Db, refundIds: readonly string[]): Promise<CreditNoteRecord[]> {
    if (refundIds.length === 0) return [];
    const rows = await db<NoteRow[]>`
      SELECT ${db.unsafe(NOTE_SELECT)} FROM credit_notes n JOIN invoices i ON i.id = n.invoice_id
      WHERE n.refund_id IN ${db([...new Set(refundIds)])}
      ORDER BY n.issued_at, n.credit_note_number`;
    return rows.map(toNote);
  }
}
