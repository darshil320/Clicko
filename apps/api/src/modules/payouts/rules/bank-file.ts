/**
 * The bulk-NEFT bank file (ADR-0026 D3), pure: one row per transfer, with the full account
 * number. This is the only place a full account number is ever written out, and the file is
 * only produced on an audited download. A row that a bank would reject is refused here instead.
 */
import { PAYOUT_CONFIG } from '../payouts.config';
import { csvDocument, rupees } from './csv';

const ACCOUNT_NUMBER = /^[0-9]{9,18}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const NAME_DISALLOWED = /[^A-Za-z0-9 .]/g;

export interface BankFileRow {
  readonly reference: string;
  readonly beneficiaryName: string;
  readonly accountNumber: string;
  readonly ifsc: string;
  readonly amountPaise: bigint;
}

export const BANK_FILE_HEADER = [
  'Payment Type',
  'Beneficiary Name',
  'Beneficiary Account Number',
  'IFSC',
  'Amount (INR)',
  'Payment Reference',
  'Narration',
] as const;

/** Letters, digits, spaces and dots only, single-spaced, cut to the bank's limit. */
export function beneficiaryName(raw: string): string {
  return raw
    .replace(NAME_DISALLOWED, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PAYOUT_CONFIG.bankFile.beneficiaryNameMax)
    .trim();
}

export class BankFileRowError extends Error {
  constructor(
    readonly reference: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankFileRowError';
  }
}

function check(row: BankFileRow): void {
  if (!ACCOUNT_NUMBER.test(row.accountNumber)) {
    throw new BankFileRowError(row.reference, `${row.reference}: the account number is not valid`);
  }
  if (!IFSC.test(row.ifsc)) {
    throw new BankFileRowError(row.reference, `${row.reference}: the IFSC is not valid`);
  }
  if (row.amountPaise <= 0n) {
    throw new BankFileRowError(row.reference, `${row.reference}: the amount must be positive`);
  }
  if (beneficiaryName(row.beneficiaryName) === '') {
    throw new BankFileRowError(row.reference, `${row.reference}: the account holder is missing`);
  }
}

export function bankFileCsv(batchRef: string, rows: readonly BankFileRow[]): string {
  for (const row of rows) check(row);
  const narration = `${PAYOUT_CONFIG.bankFile.narrationPrefix} ${batchRef}`;
  return csvDocument(
    BANK_FILE_HEADER,
    rows.map((r) => [
      PAYOUT_CONFIG.bankFile.paymentType,
      beneficiaryName(r.beneficiaryName),
      r.accountNumber,
      r.ifsc,
      rupees(r.amountPaise),
      r.reference,
      narration,
    ]),
  );
}
