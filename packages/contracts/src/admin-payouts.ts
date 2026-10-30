import { z } from 'zod';
import { AdminListQuery, AdminPage } from './admin.js';
import { IsoDateTime, Uuid } from './common.js';
import { BasisPoints, MoneyPaise, MoneyPaiseString } from './money.js';

/**
 * ADR-0026 D3 (stream B) — photographer payouts, weekly batches, the bulk-NEFT bank file, TDS
 * (s.194C until the CA rules) and the self-billed payout statement. FINANCE and SUPER_ADMIN only.
 *
 * Money: one payout or one transfer is `MoneyPaise`; batch and report totals are
 * `MoneyPaiseString` (ADR-0007: aggregates never travel as JS numbers). Full bank account numbers
 * and PANs never appear in these JSON views — only in the downloaded files, and every download is
 * audited.
 */

// ── Shared pieces ───────────────────────────────────────────────────────────

export const PayoutBatchKind = z.enum(['WEEKLY', 'OFF_CYCLE']);
export type PayoutBatchKind = z.infer<typeof PayoutBatchKind>;

/** DRAFT → EXPORTED (bank file out) → PARTIALLY_PAID → PAID (every transfer has its UTR). */
export const PayoutBatchState = z.enum(['DRAFT', 'EXPORTED', 'PARTIALLY_PAID', 'PAID']);
export type PayoutBatchState = z.infer<typeof PayoutBatchState>;

/** One bank transfer = one photographer in one batch (all their payouts in it, netted). */
export const PayoutTransferState = z.enum([
  'IN_DRAFT',
  /** Exported, not yet in a bank file. */
  'READY_FOR_BANK_FILE',
  /** In a bank file; waiting for the bank's UTR. */
  'AWAITING_PAYMENT',
  'PAID',
  'FAILED',
  /** Deductions and TDS took the whole amount: settled with no bank transfer. */
  'NOTHING_TO_PAY',
]);
export type PayoutTransferState = z.infer<typeof PayoutTransferState>;

/** Why a photographer cannot be put in a batch yet (they stay in "Due"). */
export const PayoutBlocker = z.enum(['NO_BANK_ACCOUNT', 'BANK_NOT_VERIFIED']);
export type PayoutBlocker = z.infer<typeof PayoutBlocker>;

/** Worth knowing, never blocking. */
export const PayoutNotice = z.enum(['NO_VALID_PAN', 'BREACH_UNDER_REVIEW', 'GST_REGISTERED']);
export type PayoutNotice = z.infer<typeof PayoutNotice>;

export const PayoutDeductionKind = z.enum(['LATE_DELIVERY', 'PENALTY']);
export type PayoutDeductionKind = z.infer<typeof PayoutDeductionKind>;

/** The bank account as the screen shows it: never the full number. */
export const PayoutBankView = z.object({
  holder: z.string(),
  bankName: z.string().nullable(),
  ifsc: z.string(),
  last4: z.string().regex(/^[0-9A-Za-z]{4}$/),
  verified: z.boolean(),
});
export type PayoutBankView = z.infer<typeof PayoutBankView>;

/** PAN masked on screen ("XXXXXX234F"); valid = on file and verified (else s.206AA, 20 %). */
export const PayoutPanView = z.object({
  masked: z.string().nullable(),
  valid: z.boolean(),
});
export type PayoutPanView = z.infer<typeof PayoutPanView>;

export const PayoutTotals = z.object({
  payeeCount: z.int().min(0),
  payoutCount: z.int().min(0),
  grossPaise: MoneyPaiseString,
});
export type PayoutTotals = z.infer<typeof PayoutTotals>;

// ── Due ─────────────────────────────────────────────────────────────────────

export const AdminPayoutDueLine = z.object({
  payoutId: Uuid,
  bookingId: Uuid,
  bookingReference: z.string(),
  /** Delivery + 3 days (v0.2 G-23). */
  eligibleAt: IsoDateTime,
  grossPaise: MoneyPaise,
  /** A late delivery on this booking is still being decided: a deduction may follow later. */
  breachUnderReview: z.boolean(),
});
export type AdminPayoutDueLine = z.infer<typeof AdminPayoutDueLine>;

export const AdminPayoutDuePayee = z.object({
  photographerId: Uuid,
  name: z.string(),
  cityName: z.string().nullable(),
  bank: PayoutBankView.nullable(),
  pan: PayoutPanView,
  payoutCount: z.int().min(0),
  grossPaise: MoneyPaise,
  blockers: z.array(PayoutBlocker),
  notices: z.array(PayoutNotice),
  lines: z.array(AdminPayoutDueLine),
});
export type AdminPayoutDuePayee = z.infer<typeof AdminPayoutDuePayee>;

/** GET /admin/payouts/due — everything due now, and what a batch made now would take. */
export const AdminPayoutsDue = z.object({
  asOf: IsoDateTime,
  /** Due now and payable (blocked photographers excluded): what the next batch takes. */
  ready: PayoutTotals,
  /** Due now but waiting on bank details. */
  blocked: PayoutTotals,
  /** Falling due in the next 7 days. */
  upcoming: PayoutTotals.extend({ until: IsoDateTime }),
  /** The open draft batch: there is at most one. */
  draft: z.object({ id: Uuid, reference: z.string() }).nullable(),
  /** WEEKLY on a Monday (IST) while this week's batch does not exist yet, else OFF_CYCLE. */
  nextBatchKind: PayoutBatchKind,
  /** The next Monday run (IST date). */
  nextWeeklyRunOn: z.iso.date(),
  payees: z.array(AdminPayoutDuePayee),
  /** More photographers are due than one answer lists (the totals still count them all). */
  truncated: z.boolean(),
});
export type AdminPayoutsDue = z.infer<typeof AdminPayoutsDue>;

// ── Batches ─────────────────────────────────────────────────────────────────

export const AdminPayoutBatchSummary = z.object({
  id: Uuid,
  reference: z.string(),
  kind: PayoutBatchKind,
  state: PayoutBatchState,
  createdAt: IsoDateTime,
  /** Payouts due by this instant went in. */
  cutoffAt: IsoDateTime,
  exportedAt: IsoDateTime.nullable(),
  paidAt: IsoDateTime.nullable(),
  payeeCount: z.int().min(0),
  payoutCount: z.int().min(0),
  transfersAwaiting: z.int().min(0),
  transfersPaid: z.int().min(0),
  transfersFailed: z.int().min(0),
  grossPaise: MoneyPaiseString,
  deductionsPaise: MoneyPaiseString,
  tdsPaise: MoneyPaiseString,
  /** What leaves the bank. */
  netPaise: MoneyPaiseString,
  /** Transfers exported but not yet in a bank file (the next "Create bank file" takes them). */
  transfersReady: z.int().min(0),
});
export type AdminPayoutBatchSummary = z.infer<typeof AdminPayoutBatchSummary>;

export const AdminPayoutLine = z.object({
  payoutId: Uuid,
  bookingId: Uuid,
  bookingReference: z.string(),
  eligibleAt: IsoDateTime,
  grossPaise: MoneyPaise,
  /** '194C' (or '194J'); null while no TDS applies. */
  tdsSection: z.string().nullable(),
  tdsRateBps: BasisPoints,
  tdsPaise: MoneyPaise,
  penaltyDeductionPaise: MoneyPaise,
  /** Late-delivery deductions and amounts brought forward. */
  otherDeductionPaise: MoneyPaise,
  netPaise: MoneyPaise,
});
export type AdminPayoutLine = z.infer<typeof AdminPayoutLine>;

/** A deduction recognised in this batch (it may be recovered now or carried forward). */
export const AdminPayoutDeduction = z.object({
  kind: PayoutDeductionKind,
  bookingReference: z.string(),
  rateBps: BasisPoints,
  /** The payout the percentage is taken from. */
  basisPaise: MoneyPaise,
  amountPaise: MoneyPaise,
});
export type AdminPayoutDeduction = z.infer<typeof AdminPayoutDeduction>;

export const AdminPayoutTransfer = z.object({
  photographerId: Uuid,
  name: z.string(),
  /** The bank file's payment reference; null in a draft and when nothing is paid. */
  reference: z.string().nullable(),
  state: PayoutTransferState,
  bank: PayoutBankView.nullable(),
  pan: PayoutPanView,
  grossPaise: MoneyPaise,
  /** Deductions recovered in this batch. */
  deductionsPaise: MoneyPaise,
  tdsPaise: MoneyPaise,
  netPaise: MoneyPaise,
  /** Owed from earlier batches when this one was made. */
  broughtForwardPaise: MoneyPaise,
  /** Still owed after this batch: recovered from the next payouts. */
  carriedForwardPaise: MoneyPaise,
  utr: z.string().nullable(),
  paidAt: IsoDateTime.nullable(),
  failureReason: z.string().nullable(),
  lines: z.array(AdminPayoutLine),
  deductions: z.array(AdminPayoutDeduction),
});
export type AdminPayoutTransfer = z.infer<typeof AdminPayoutTransfer>;

export const AdminPayoutBatchDetail = AdminPayoutBatchSummary.extend({
  transfers: z.array(AdminPayoutTransfer),
});
export type AdminPayoutBatchDetail = z.infer<typeof AdminPayoutBatchDetail>;

/** GET /admin/payouts/batches — newest first. */
export const AdminPayoutBatchPage = AdminPage(AdminPayoutBatchSummary);
export type AdminPayoutBatchPage = z.infer<typeof AdminPayoutBatchPage>;
export const AdminPayoutBatchQuery = AdminListQuery;
export type AdminPayoutBatchQuery = z.input<typeof AdminPayoutBatchQuery>;

/** POST /admin/payouts/batches — a draft of everything due now (one draft at a time). */
export const AdminCreatePayoutBatchBody = z.object({ kind: PayoutBatchKind });
export type AdminCreatePayoutBatchBody = z.infer<typeof AdminCreatePayoutBatchBody>;

/** A bank's transaction reference: NEFT UTR (16), RTGS (22), IMPS RRN (12). */
export const PayoutUtr = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,30}$/, 'Enter the bank reference (UTR): 6 to 30 letters and digits');
export type PayoutUtr = z.infer<typeof PayoutUtr>;

/** POST /admin/payouts/batches/:batchId/mark-paid — one UTR per transfer. */
export const AdminMarkPayoutsPaidBody = z.object({
  transfers: z
    .array(z.object({ photographerId: Uuid, utr: PayoutUtr }))
    .min(1)
    .max(500)
    .refine((t) => new Set(t.map((x) => x.photographerId)).size === t.length, {
      message: 'Each photographer can appear once',
    })
    .refine((t) => new Set(t.map((x) => x.utr)).size === t.length, {
      message: 'Each transfer has its own UTR',
    }),
});
export type AdminMarkPayoutsPaidBody = z.infer<typeof AdminMarkPayoutsPaidBody>;

/** POST /admin/payouts/batches/:batchId/mark-failed — the bank returned the transfer. */
export const AdminMarkPayoutFailedBody = z.object({
  photographerId: Uuid,
  reason: z
    .string()
    .trim()
    .min(3)
    .max(500)
    // Bank messages often quote the account number: it must never be stored in clear (Inv. 16).
    .refine((r) => !/\d{9,}/.test(r.replace(/[\s-]/g, '')), {
      message: 'Leave out account numbers: describe what the bank said',
    }),
});
export type AdminMarkPayoutFailedBody = z.infer<typeof AdminMarkPayoutFailedBody>;

/** POST /admin/payouts/batches/:batchId/retry — send a failed transfer again (next bank file). */
export const AdminRetryPayoutBody = z.object({ photographerId: Uuid });
export type AdminRetryPayoutBody = z.infer<typeof AdminRetryPayoutBody>;

/** POST /admin/payouts/batches/:batchId/discard — a draft only; its payouts go back to Due. */
export const AdminPayoutBatchDiscarded = z.object({
  id: Uuid,
  reference: z.string(),
  discarded: z.literal(true),
});
export type AdminPayoutBatchDiscarded = z.infer<typeof AdminPayoutBatchDiscarded>;

// ── Files (bank file, statement, TDS report) ────────────────────────────────

/**
 * A generated CSV, inside the JSON envelope like every answer. Never cached (no-store) and never
 * kept by the idempotency store (files are GETs); each download writes an audit row.
 */
export const AdminPayoutFile = z.object({
  filename: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
  contentType: z.literal('text/csv'),
  content: z.string().max(10_000_000),
  rowCount: z.int().min(0),
  totalPaise: MoneyPaiseString,
});
export type AdminPayoutFile = z.infer<typeof AdminPayoutFile>;

// ── TDS ─────────────────────────────────────────────────────────────────────

/** An Indian financial year, '2026-27' (1 April – 31 March, IST). */
export const FinancialYearLabel = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'must look like 2026-27')
  .refine(
    (fy) => (Number(fy.slice(0, 4)) + 1) % 100 === Number(fy.slice(5)),
    'must be two consecutive years',
  );
export type FinancialYearLabel = z.infer<typeof FinancialYearLabel>;

/** A calendar month, '2026-11'. */
export const TdsMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must look like 2026-11');
export type TdsMonth = z.infer<typeof TdsMonth>;

export const AdminTdsQuery = z.object({ fy: FinancialYearLabel.optional() });
export type AdminTdsQuery = z.input<typeof AdminTdsQuery>;

/** The rules in force (constants until the CA rules; shown on the TDS tab). */
export const AdminTdsRules = z.object({
  section: z.string(),
  individualRateBps: BasisPoints,
  otherRateBps: BasisPoints,
  noPanRateBps: BasisPoints,
  singlePaymentLimitPaise: MoneyPaise,
  yearlyLimitPaise: MoneyPaise,
});
export type AdminTdsRules = z.infer<typeof AdminTdsRules>;

export const AdminTdsMonthRow = z.object({
  month: TdsMonth,
  payeeCount: z.int().min(0),
  payoutCount: z.int().min(0),
  grossPaise: MoneyPaiseString,
  tdsPaise: MoneyPaiseString,
  /** Deposit with the government by the 7th of the next month (30 April for March). */
  depositDueOn: z.iso.date(),
});
export type AdminTdsMonthRow = z.infer<typeof AdminTdsMonthRow>;

/** GET /admin/payouts/tds?fy=2026-27 — month by month, for the CA. */
export const AdminTdsSummary = z.object({
  financialYear: FinancialYearLabel,
  rules: AdminTdsRules,
  months: z.array(AdminTdsMonthRow),
  grossPaise: MoneyPaiseString,
  tdsPaise: MoneyPaiseString,
  /** The years with payouts on record, newest first (always includes the current one). */
  financialYears: z.array(FinancialYearLabel),
});
export type AdminTdsSummary = z.infer<typeof AdminTdsSummary>;

// ── Today (ADR-0026 D8) ─────────────────────────────────────────────────────

/** The payouts desk's numbers for the Today page (PayoutsService.overviewCount). */
export const AdminPayoutsOverview = z.object({
  /** Not yet in a batch and due before next Monday's run (IST). */
  dueThisWeek: z.object({ payoutCount: z.int().min(0), grossPaise: MoneyPaiseString }),
  /** Bank file exported, not every transfer marked paid yet. */
  batchesAwaitingPayment: z.int().min(0),
});
export type AdminPayoutsOverview = z.infer<typeof AdminPayoutsOverview>;
