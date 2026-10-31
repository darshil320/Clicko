import type { AdminPayoutFile, AdminTdsSummary } from '@clickco/contracts';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type postgres from 'postgres';
import type { z } from 'zod';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import { BANK_ACCOUNT_CIPHER, type BankAccountCipher } from './bank-account-cipher';
import { PayoutReadsService } from './payout-reads.service';
import { TDS_RULES } from './payouts.config';
import { PAYEE_DIRECTORY, type PayeeDirectoryPort } from './ports';
import { BatchesRepository, type BatchRecord } from './repositories/batches.repository';
import { DeductionsRepository } from './repositories/deductions.repository';
import { type PayoutRecord, PayoutsRepository } from './repositories/payouts.repository';
import { type BankFileRow, BankFileRowError, bankFileCsv } from './rules/bank-file';
import { rupees } from './rules/csv';
import {
  type FinancialYear,
  financialYearFromLabel,
  financialYearOf,
  istDate,
  istMonth,
  monthRange,
  monthsOf,
  tdsDepositDueOn,
} from './rules/ist-calendar';
import { statementCsv } from './rules/statement';
import { tdsReportCsv } from './rules/tds-report';

type FileWire = z.input<typeof AdminPayoutFile>;
type TdsSummaryWire = z.input<typeof AdminTdsSummary>;

const conflict = (code: string, message: string) => new ConflictException({ code, message });
const sum = (ps: readonly PayoutRecord[], f: (p: PayoutRecord) => bigint): bigint =>
  ps.reduce((s, p) => s + f(p), 0n);
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const file = (filename: string, content: string, rowCount: number, total: bigint): FileWire => ({
  filename,
  contentType: 'text/csv',
  content,
  rowCount,
  totalPaise: total.toString(),
});

/**
 * The payouts desk's downloads (ADR-0026 D3). Full account numbers appear only in the bank file
 * and full PANs only in the statement and the TDS report; the controller audits every download.
 */
@Injectable()
export class PayoutFilesService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(PayoutsRepository) private readonly payouts: PayoutsRepository,
    @Inject(BatchesRepository) private readonly batches: BatchesRepository,
    @Inject(DeductionsRepository) private readonly deductions: DeductionsRepository,
    @Inject(PayoutReadsService) private readonly reads: PayoutReadsService,
    @Inject(PAYEE_DIRECTORY) private readonly directory: PayeeDirectoryPort,
    @Inject(BANK_ACCOUNT_CIPHER) private readonly cipher: BankAccountCipher,
  ) {}

  private async batch(batchId: string): Promise<BatchRecord> {
    const batch = await this.batches.find(this.sql, batchId);
    if (!batch) {
      throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Payout batch not found' });
    }
    return batch;
  }

  /**
   * Creates the next bank file (bulk NEFT, full account numbers): every exported transfer not yet
   * in a file, which then waits for its UTR. A transfer is written into one file only, so a file
   * can never pay anyone twice; a lost file is recovered by marking its transfers failed and
   * sending them again (new references). The audit row lists the references, in the same tx.
   */
  async createBankFile(
    batchId: string,
    staffId: string,
    now: Date,
    audit: TxHook,
  ): Promise<FileWire> {
    return this.sql.begin(async (tx) => {
      const batch = await this.batches.lock(tx, batchId);
      if (!batch) {
        throw new NotFoundException({ code: 'BATCH_NOT_FOUND', message: 'Payout batch not found' });
      }
      if (batch.status === 'PENDING') throw conflict('NOT_EXPORTED', 'Export the batch first.');
      await this.payouts.lockBatch(tx, batchId);
      const ready = (await this.payouts.forBatch(tx, batchId)).filter(
        (p) => p.status === 'APPROVED',
      );
      if (ready.length === 0) {
        throw conflict(
          'NOTHING_NEW',
          'Every transfer is already in a bank file. A failed one goes into the next file once you send it again.',
        );
      }
      const rows = await this.rows(ready);
      try {
        const content = bankFileCsv(batch.reference, rows);
        const total = rows.reduce((s, r) => s + r.amountPaise, 0n);
        const sent = await this.payouts.markSent(
          tx,
          ready.map((p) => p.id),
          staffId,
          now,
        );
        if (sent !== ready.length) throw conflict('TRANSFER_CHANGED', 'Reload and try again.');
        await audit(tx, {
          before: null,
          after: {
            references: rows.map((r) => r.reference),
            rows: rows.length,
            total_paise: total.toString(),
          },
        });
        // The first transfer names the file: …-001 the first time, …-004R1 for a resend.
        const from = (rows[0]?.reference ?? batch.reference).slice(batch.reference.length);
        return file(`${batch.reference}-bank-file-${from}.csv`, content, rows.length, total);
      } catch (error) {
        if (error instanceof BankFileRowError) {
          throw conflict('BANK_DETAILS_INVALID', `${error.message}. Fix the bank details first.`);
        }
        throw error;
      }
    });
  }

  private async rows(ready: readonly PayoutRecord[]): Promise<BankFileRow[]> {
    const ids = unique(ready.map((p) => p.photographerId));
    const payees = await this.directory.payees(ids);
    const sealed = await this.directory.sealedAccountNumbers(
      unique(ready.flatMap((p) => (p.bankAccountId ? [p.bankAccountId] : []))),
    );
    return ids
      .map((id): BankFileRow => {
        const mine = ready.filter((p) => p.photographerId === id);
        const payee = payees.get(id);
        const accountId = mine[0]?.bankAccountId;
        const bank = payee?.bank;
        const secret = accountId ? sealed.get(accountId) : undefined;
        const name = payee?.name ?? 'A photographer';
        if (
          !bank?.verified ||
          bank.accountId !== accountId ||
          !secret ||
          secret.photographerId !== id
        ) {
          throw conflict(
            'BANK_CHANGED',
            `${name}'s bank details changed. Mark that transfer failed, then send it again.`,
          );
        }
        return {
          reference: mine[0]?.reference ?? '',
          beneficiaryName: bank.holder,
          accountNumber: this.openAccount(secret.sealed, id, name),
          ifsc: bank.ifsc,
          amountPaise: sum(mine, (p) => p.netPaise),
        };
      })
      .sort((a, b) => a.reference.localeCompare(b.reference));
  }

  private openAccount(sealed: Buffer, photographerId: string, name: string): string {
    try {
      return this.cipher.open(sealed, photographerId);
    } catch {
      throw conflict(
        'BANK_DETAILS_UNREADABLE',
        `${name}'s account number could not be read. Ask them to enter it again.`,
      );
    }
  }

  /** The self-billed payout statement for one photographer in one exported batch. */
  async statement(batchId: string, photographerId: string): Promise<FileWire> {
    const batch = await this.batch(batchId);
    if (batch.status === 'PENDING') throw conflict('NOT_EXPORTED', 'Export the batch first.');
    const detail = await this.reads.detail(batchId);
    const t = detail.transfers.find((x) => x.photographerId === photographerId);
    if (!t) {
      throw new NotFoundException({
        code: 'TRANSFER_NOT_FOUND',
        message: 'That photographer is not in this batch',
      });
    }
    const payee = (await this.directory.payees([photographerId])).get(photographerId);
    const big = (v: number): bigint => BigInt(v);
    const content = statementCsv({
      batchReference: batch.reference,
      issuedOn: istDate(batch.exportedAt ?? batch.createdAt),
      photographerName: t.name,
      pan: payee?.pan && PAN_FORMAT.test(payee.pan) ? payee.pan : null,
      gstRegistered: payee?.gstRegistered ?? false,
      transferReference: t.reference,
      utr: t.utr,
      lines: t.lines.map((l) => ({
        bookingReference: l.bookingReference,
        eligibleOn: istDate(new Date(l.eligibleAt)),
        grossPaise: big(l.grossPaise),
        tdsSection: l.tdsSection,
        tdsRateBps: l.tdsRateBps,
        tdsPaise: big(l.tdsPaise),
        deductionsPaise: big(l.penaltyDeductionPaise + l.otherDeductionPaise),
        netPaise: big(l.netPaise),
      })),
      deductions: t.deductions.map((d) => ({
        label: d.kind === 'LATE_DELIVERY' ? 'Late delivery' : 'Penalty',
        bookingReference: d.bookingReference,
        rateBps: d.rateBps,
        basisPaise: big(d.basisPaise),
        amountPaise: big(d.amountPaise),
      })),
      totals: {
        grossPaise: big(t.grossPaise),
        broughtForwardPaise: big(t.broughtForwardPaise),
        deductionsPaise: big(t.deductionsPaise),
        tdsPaise: big(t.tdsPaise),
        netPaise: big(t.netPaise),
        carriedForwardPaise: big(t.carriedForwardPaise),
      },
    });
    const name = t.reference ?? `${batch.reference}-${photographerId.slice(0, 8)}`;
    return file(`${name}-statement.csv`, content, t.lines.length, big(t.netPaise));
  }

  /** Month by month for one financial year (IST), by the date each payout was credited. */
  async tdsSummary(fyLabel: string | undefined, now: Date): Promise<TdsSummaryWire> {
    const fy = fyLabel ? financialYearFromLabel(fyLabel) : financialYearOf(now);
    const [rows, first] = await Promise.all([
      this.payouts.creditedBetween(this.sql, fy.start, fy.end),
      this.payouts.firstCreditedAt(this.sql),
    ]);
    const months = monthsOf(fy).map((month) => {
      const mine = rows.filter((p) => p.creditedAt && istMonth(p.creditedAt) === month);
      return {
        month,
        payeeCount: unique(mine.map((p) => p.photographerId)).length,
        payoutCount: mine.length,
        grossPaise: sum(mine, (p) => p.grossPaise).toString(),
        tdsPaise: sum(mine, (p) => p.tdsPaise).toString(),
        depositDueOn: tdsDepositDueOn(month),
      };
    });
    return {
      financialYear: fy.label,
      rules: {
        section: TDS_RULES.section,
        individualRateBps: TDS_RULES.individualRateBps,
        otherRateBps: TDS_RULES.otherRateBps,
        noPanRateBps: TDS_RULES.noPanRateBps,
        singlePaymentLimitPaise: Number(TDS_RULES.singlePaymentLimitPaise),
        yearlyLimitPaise: Number(TDS_RULES.yearlyLimitPaise),
      },
      months,
      grossPaise: sum(rows, (p) => p.grossPaise).toString(),
      tdsPaise: sum(rows, (p) => p.tdsPaise).toString(),
      financialYears: yearsSince(first ?? now, now, fy),
    };
  }

  /** Every payout credited in the month: the CA deposits, files 26Q and issues Form 16A. */
  async tdsReport(month: string): Promise<FileWire> {
    const { start, end } = monthRange(month);
    const rows = await this.payouts.creditedBetween(this.sql, start, end);
    const [payees, refs] = await Promise.all([
      this.directory.payees(unique(rows.map((p) => p.photographerId))),
      this.reads.references(rows.map((p) => p.bookingId)),
    ]);
    const content = tdsReportCsv(
      rows.map((p) => {
        const payee = payees.get(p.photographerId);
        const pan = payee?.pan && PAN_FORMAT.test(payee.pan) ? payee.pan : null;
        return {
          name: payee?.name ?? 'Unknown photographer',
          pan,
          section: p.tdsSection,
          rateBps: p.tdsRateBps,
          grossPaise: p.grossPaise,
          tdsPaise: p.tdsPaise,
          creditedOn: p.creditedAt ? istDate(p.creditedAt) : '',
          payoutReference: p.reference ?? p.batchReference ?? '',
          bookingReference: refs.get(p.bookingId) ?? '',
          note: tdsNote(p, payee?.panVerified ?? false),
        };
      }),
    );
    return file(
      `tds-${TDS_RULES.section}-${month}.csv`,
      content,
      rows.length,
      sum(rows, (p) => p.tdsPaise),
    );
  }
}

function tdsNote(p: PayoutRecord, panVerified: boolean): string | null {
  if (p.tdsPaise === 0n) return 'No TDS: under the single-payment and yearly limits';
  const notes = [
    p.tdsRateBps === TDS_RULES.noPanRateBps
      ? `No valid PAN${panVerified ? '' : ' (not verified)'}: s.206AA rate`
      : null,
    p.tdsBasePaise > p.grossPaise
      ? `Year total crossed the limit: TDS on ${rupees(p.tdsBasePaise)} (the year so far)`
      : null,
    p.tdsPaise === p.grossPaise ? 'TDS took the whole payout; the rest follows' : null,
  ].filter((x): x is string => x !== null);
  return notes.length > 0 ? notes.join('; ') : null;
}

/** Financial years from the first credit to now, newest first (always the current and asked). */
function yearsSince(first: Date, now: Date, asked: FinancialYear): string[] {
  const from = Number(financialYearOf(first).label.slice(0, 4));
  const to = Number(financialYearOf(now).label.slice(0, 4));
  const labels = new Set<string>([asked.label]);
  for (let y = to; y >= Math.min(from, to); y -= 1)
    labels.add(financialYearOf(new Date(Date.UTC(y, 6, 1))).label);
  return [...labels].sort().reverse();
}
