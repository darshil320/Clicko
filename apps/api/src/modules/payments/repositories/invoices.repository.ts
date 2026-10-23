import { Injectable } from '@nestjs/common';
import type { InvoiceSeriesKey } from '../financial-year';
import type { InvoiceSplit } from '../invoice-split';
import type { Db, InvoiceRecord, PaymentPurpose, Tx } from '../payments.types';

const pg = (paise: bigint): string => paise.toString();

export interface NewInvoice extends InvoiceSplit {
  readonly invoiceNumber: string;
  readonly bookingId: string;
  readonly userId: string;
  readonly purpose: PaymentPurpose;
  readonly sacCode: string;
  readonly placeOfSupply: string;
  readonly issuedAt: Date;
}

/** invoice_series + invoices. Numbers are allocated in the caller's tx, so a rollback leaves no gap. */
@Injectable()
export class InvoicesRepository {
  async ensureSeries(tx: Tx, s: InvoiceSeriesKey): Promise<void> {
    await tx`
      INSERT INTO invoice_series (code, financial_year, prefix)
      VALUES (${s.code}, ${s.financialYear}, ${s.prefix})
      ON CONFLICT (code, financial_year) DO NOTHING`;
  }

  async allocateNumber(tx: Tx, code: string, financialYear: string): Promise<string> {
    const [row] = await tx<
      { n: string }[]
    >`SELECT allocate_invoice_number(${code}, ${financialYear}) AS n`;
    if (!row) throw new Error('allocate_invoice_number returned nothing');
    return row.n;
  }

  async insert(tx: Tx, i: NewInvoice): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO invoices (invoice_number, booking_id, user_id, purpose, taxable_amount_paise,
                            cgst_paise, sgst_paise, igst_paise, total_amount_paise, sac_code,
                            place_of_supply, issued_at)
      VALUES (${i.invoiceNumber}, ${i.bookingId}, ${i.userId}, ${i.purpose}, ${pg(i.taxablePaise)},
              ${pg(i.cgstPaise)}, ${pg(i.sgstPaise)}, ${pg(i.igstPaise)}, ${pg(i.totalPaise)},
              ${i.sacCode}, ${i.placeOfSupply}, ${i.issuedAt})
      RETURNING id`;
    if (!row) throw new Error('invoices.insert: no row returned');
    return row.id;
  }

  async forBooking(db: Db, bookingId: string): Promise<InvoiceRecord[]> {
    const rows = await db<
      {
        id: string;
        invoice_number: string;
        purpose: PaymentPurpose;
        taxable_amount_paise: string;
        cgst_paise: string;
        sgst_paise: string;
        igst_paise: string;
        total_amount_paise: string;
        issued_at: Date;
      }[]
    >`
      SELECT id, invoice_number, purpose, taxable_amount_paise, cgst_paise, sgst_paise, igst_paise,
             total_amount_paise, issued_at
      FROM invoices WHERE booking_id = ${bookingId} AND cancelled_at IS NULL
      ORDER BY issued_at, invoice_number`;
    return rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      purpose: r.purpose,
      taxablePaise: BigInt(r.taxable_amount_paise),
      cgstPaise: BigInt(r.cgst_paise),
      sgstPaise: BigInt(r.sgst_paise),
      igstPaise: BigInt(r.igst_paise),
      totalPaise: BigInt(r.total_amount_paise),
      issuedAt: r.issued_at,
    }));
  }
}
