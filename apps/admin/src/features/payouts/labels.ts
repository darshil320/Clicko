import type {
  PayoutBatchState,
  PayoutBlocker,
  PayoutNotice,
  PayoutTransferState,
} from '@clickco/contracts';
import { formatINR } from '@clickco/utils';

/** Plain-language labels and money for the payouts desk (ADR-0026 D8). Pure. */

/** "₹1,24,560" from paise (number or bigint). */
export const rupees = (paise: number | bigint): string => formatINR(paise);

/** "₹1,24,560.50" — exact, for statements and the mark-paid sheet. */
export const rupeesExact = (paise: number | bigint): string =>
  formatINR(paise, { showPaise: true });

export const count = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;

/** "₹1,24,560 to 18 photographers". */
export const toPhotographers = (paise: number | bigint, photographers: number): string =>
  `${rupees(paise)} to ${count(photographers, 'photographer')}`;

type Tone = 'neutral' | 'success' | 'warning' | 'destructive' | 'primary';

export const BATCH_STATE: Readonly<Record<PayoutBatchState, { label: string; tone: Tone }>> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  EXPORTED: { label: 'Sent to bank', tone: 'warning' },
  PARTIALLY_PAID: { label: 'Partly paid', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
};

export const TRANSFER_STATE: Readonly<Record<PayoutTransferState, { label: string; tone: Tone }>> =
  {
    IN_DRAFT: { label: 'In draft', tone: 'neutral' },
    READY_FOR_BANK_FILE: { label: 'Ready for bank file', tone: 'neutral' },
    AWAITING_PAYMENT: { label: 'Waiting for bank', tone: 'warning' },
    PAID: { label: 'Paid', tone: 'success' },
    FAILED: { label: 'Failed', tone: 'destructive' },
    NOTHING_TO_PAY: { label: 'Nothing to pay', tone: 'neutral' },
  };

export const BLOCKER: Readonly<Record<PayoutBlocker, string>> = {
  NO_BANK_ACCOUNT: 'No bank account',
  BANK_NOT_VERIFIED: 'Bank not verified',
};

export const NOTICE: Readonly<Record<PayoutNotice, string>> = {
  NO_VALID_PAN: 'No PAN · 20% TDS',
  BREACH_UNDER_REVIEW: 'Late delivery under review',
  GST_REGISTERED: 'GST registered',
};

/** 2500 → "25%"; 100 → "1%". */
export const percent = (bps: number): string => `${bps / 100}%`;

/** "HDFC Bank ···· 7890". */
export const maskedAccount = (bank: { bankName: string | null; last4: string }): string =>
  `${bank.bankName ? `${bank.bankName} ` : ''}···· ${bank.last4}`;

/** "2026-12" → "December 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 1)));
}

/** Today in IST as YYYY-MM-DD, compared as a string with `depositDueOn`. */
export function istToday(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}
