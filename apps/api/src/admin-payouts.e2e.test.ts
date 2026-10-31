import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobRegistry } from './infra/queues/job-registry';
import { JOB } from './infra/queues/queue-names';
import { SecretBox } from './modules/admin/auth/secret-box';
import { base32Decode } from './modules/admin/auth/totp';
import { checkedOutBooking, fakeFile, SIGNATURES } from './modules/media/__tests__/media-fixtures';
import { BANK_ACCOUNT_CIPHER, type BankAccountCipher } from './modules/payouts/bank-account-cipher';
import { PayoutsService } from './modules/payouts/payouts.service';
import { payWhatIsDue, uploadAll } from './test-support/delivery-fixtures';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { setNow } from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff, cityIdOf, codeFor, staffToken } from './test-support/staff-fixtures';

/** Monday 7 Dec 2026, 10:00 IST. */
const NOW = new Date('2026-12-07T04:30:00.000Z');
/** The next Monday, 14 Dec 2026, 10:00 IST: the weekly run. */
const NEXT_MONDAY = new Date('2026-12-14T04:30:00.000Z');
const ACCOUNT = '001234567890';
const PAN = 'ABCPE1234F';
let keySeq = 0;
const idem = () => `admin-payouts-${String(++keySeq).padStart(6, '0')}`;
/** Every test staff member's authenticator secret (base32; the replay guard is per person). */
const TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/**
 * ADR-0026 D3 end to end: a booking walked to DELIVERED accrues a payout (due +3 days); a
 * photographer without a verified bank account is held back; the weekly batch assesses TDS
 * (s.194C, 1 % over ₹30,000) and a penalty deduction; draft → discard → draft → export (ledger,
 * vendor invoice) → bank file (full number in the file only, audited) → failed → retried → paid
 * with a UTR; statement and TDS report; FINANCE only, every city.
 */
describe.runIf(TEST_DATABASE_URL)('payouts desk', () => {
  let e2e: E2eApp;
  const staff = {} as Record<'finance' | 'finance2' | 'financeSurat' | 'ops' | 'admin', string>;
  let proId: string;
  let bookingId: string;
  let batchId: string;

  const as = async (who: keyof typeof staff) => staffToken(e2e, staff[who]);
  const get = async (who: keyof typeof staff, path: string) =>
    e2e.call('GET', path, { token: await as(who) });
  const post = async (who: keyof typeof staff, path: string, body?: unknown) =>
    e2e.call('POST', path, {
      token: await as(who),
      idempotencyKey: idem(),
      ...(body === undefined ? {} : { body }),
    });
  /** A fresh authenticator code (one step later, so it is never a replay). */
  const code = () => {
    e2e.advance(30_000);
    return codeFor(e2e, TOTP);
  };
  const audits = (action: string) =>
    e2e.db.sql<{ entity_id: string | null; after_state: Json }[]>`
      SELECT entity_id, after_state FROM audit_logs WHERE action = ${action} ORDER BY id`;
  const payout = async () =>
    (
      await e2e.db.sql<Json[]>`
        SELECT id, status, gross_paise::text AS gross, net_paise::text AS net, tds_paise::text AS tds,
               tds_section, tds_rate_bps, penalty_deduction_paise::text AS penalty, eligible_at,
               utr, batch_id, vendor_invoice_id
        FROM payouts WHERE booking_id = ${bookingId}`
    )[0] as Json;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    staff.finance = (await bootstrapStaff(e2e, 'finance@clickco.test', 'FINANCE')).id;
    staff.financeSurat = (
      await bootstrapStaff(
        e2e,
        'finance-surat@clickco.test',
        'FINANCE',
        await cityIdOf(e2e, 'Surat'),
      )
    ).id;
    staff.ops = (await bootstrapStaff(e2e, 'ops@clickco.test', 'OPS_AGENT')).id;
    staff.admin = (await bootstrapStaff(e2e, 'admin@clickco.test', 'SUPER_ADMIN')).id;
    staff.finance2 = (await bootstrapStaff(e2e, 'finance-2@clickco.test', 'FINANCE')).id;
    const box = new SecretBox(e2e.env.STAFF_TOTP_KEY);
    for (const id of Object.values(staff)) {
      await e2e.db.sql`
        UPDATE staff_users SET totp_secret = ${box.seal(base32Decode(TOTP), id)} WHERE id = ${id}`;
    }

    proId = await insertPhotographer(e2e.db.sql, {
      phone: '+919999179401',
      name: 'Asha Patel',
      km: 3,
      categories: [{ code: 'PORTRAIT', tier: 'EXPERT' }],
    });
    const proToken = await e2e.proLogin('+919999179401');
    const walked = await checkedOutBooking(e2e, {
      clientPhone: '+919999279401',
      proToken,
      declaredFrames: 1,
    });
    bookingId = walked.bookingId;
    await uploadAll(
      e2e,
      proToken,
      bookingId,
      [
        {
          clientFileId: 'raw',
          name: 'A.CR3',
          kind: 'RAW_PHOTO',
          bytes: fakeFile(64_000, 41, SIGNATURES.CR3),
        },
        {
          clientFileId: 'jpg',
          name: 'A.JPG',
          kind: 'JPEG_PHOTO',
          bytes: fakeFile(32_000, 42, SIGNATURES.JPEG),
        },
      ],
      1,
    );
    await drainOutbox(e2e);
    await e2e.scheduler.runDue(e2e.get(JobRegistry), e2e.now(), JOB.MEDIA_JPEG_EXPORT);
    await drainOutbox(e2e);
    const qa = await e2e.call('POST', `/dev/deliveries/${bookingId}/qa`, {
      body: { result: 'PASS' },
    });
    if (qa.status !== 200) throw new Error(`qa: ${JSON.stringify(qa.json)}`);
    await payWhatIsDue(e2e, walked.userId, bookingId);
    await drainOutbox(e2e);
  }, 180_000);

  afterAll(async () => {
    await e2e?.close();
  });

  it('a delivered booking accrues one payout, due 3 days after delivery, at the accepted offer', async () => {
    const [b] = await e2e.db.sql<{ status: string; delivered_at: Date }[]>`
      SELECT status, delivered_at FROM bookings WHERE id = ${bookingId}`;
    if (!b) throw new Error('booking missing');
    expect(b.status).toBe('DELIVERED');
    const p = await payout();
    const [offer] = await e2e.db.sql<{ paise: string }[]>`
      SELECT offered_payout_paise::text AS paise FROM dispatch_attempts
      WHERE booking_id = ${bookingId} AND outcome = 'ACCEPTED'`;
    expect(p.gross).toBe(offer?.paise);
    expect(p.status).toBe('PENDING');
    expect(new Date(p.eligible_at).getTime()).toBe(b.delivered_at.getTime() + 3 * 86_400_000);
    // At-least-once: accruing again changes nothing.
    expect(await e2e.get(PayoutsService).accrueForDelivery(bookingId)).toBe('EXISTS');
    const events = await e2e.db.sql`
      SELECT 1 FROM domain_events WHERE event_type = 'payout.created' AND aggregate_id = ${p.id}`;
    expect(events).toHaveLength(1);
  });

  it('FINANCE (every city) and SUPER_ADMIN only', async () => {
    expect((await get('ops', '/admin/payouts/due')).status).toBe(403);
    const scoped = await get('financeSurat', '/admin/payouts/due');
    expect([scoped.status, scoped.json.error.code]).toEqual([403, 'FORBIDDEN']);
    expect((await get('admin', '/admin/payouts/due')).status).toBe(200);
  });

  it('not yet due: it shows as coming up; the Today count sees it this week', async () => {
    const due = await get('finance', '/admin/payouts/due');
    expect(due.json.data.ready).toEqual({ payeeCount: 0, payoutCount: 0, grossPaise: '0' });
    expect(due.json.data.upcoming.payoutCount).toBe(1);
    const today = await e2e.get(PayoutsService).overviewCount(e2e.now());
    expect(today.dueThisWeek.payoutCount).toBe(1);
  });

  it('due, but no bank account: blocked, and a batch has nothing to take', async () => {
    setNow(e2e, NEXT_MONDAY);
    const due = await get('finance', '/admin/payouts/due');
    expect(due.json.data.blocked.payoutCount).toBe(1);
    expect(due.json.data.payees[0]).toMatchObject({
      photographerId: proId,
      blockers: ['NO_BANK_ACCOUNT'],
      notices: ['NO_VALID_PAN'],
    });
    expect(due.json.data.nextBatchKind).toBe('WEEKLY');
    const none = await post('finance', '/admin/payouts/batches', { kind: 'WEEKLY' });
    expect([none.status, none.json.error.code]).toEqual([409, 'NOTHING_DUE']);
  });

  it('with a verified bank account and PAN: ready, the account masked on screen', async () => {
    const cipher = e2e.get<BankAccountCipher>(BANK_ACCOUNT_CIPHER);
    await e2e.db.sql`
      INSERT INTO photographer_bank_accounts (photographer_id, account_holder, account_number_enc,
        account_last4, ifsc, bank_name, is_primary, verified_at)
      VALUES (${proId}, 'Asha Patel', ${cipher.seal(ACCOUNT, proId)}, '7890', 'HDFC0001234',
              'HDFC Bank', true, now())`;
    await e2e.db.sql`UPDATE photographers SET pan_number = ${PAN} WHERE id = ${proId}`;
    // A big job (over ₹30,000: 1 % TDS) and a 10 % penalty on it.
    await e2e.db.sql`
      UPDATE payouts SET gross_paise = 4000000, net_paise = 4000000 WHERE booking_id = ${bookingId}`;
    await e2e.db.sql`
      INSERT INTO photographer_penalties (photographer_id, booking_id, kind, severity, payout_deduction_bps)
      VALUES (${proId}, ${bookingId}, 'LATE_UPLOAD', 1, 1000)`;
    const due = await get('finance', '/admin/payouts/due');
    expect(due.json.data.ready).toEqual({ payeeCount: 1, payoutCount: 1, grossPaise: '4000000' });
    expect(due.json.data.payees[0]).toMatchObject({
      blockers: [],
      notices: [],
      bank: { last4: '7890', ifsc: 'HDFC0001234', verified: true },
      pan: { masked: 'XXXXXX234F', valid: true },
    });
    expect(JSON.stringify(due.json)).not.toContain(ACCOUNT);
    expect(JSON.stringify(due.json)).not.toContain(PAN);
  });

  it('the weekly draft: TDS 1 %, the penalty off, one draft at a time; discard puts it back', async () => {
    const draft = await post('finance', '/admin/payouts/batches', { kind: 'WEEKLY' });
    expect(draft.status).toBe(201);
    expect(draft.json.data).toMatchObject({
      reference: 'PO20261214W',
      kind: 'WEEKLY',
      state: 'DRAFT',
      grossPaise: '4000000',
      tdsPaise: '40000',
      deductionsPaise: '400000',
      netPaise: '3560000',
    });
    expect(draft.json.data.transfers[0]).toMatchObject({
      state: 'IN_DRAFT',
      tdsPaise: 40_000,
      deductionsPaise: 400_000,
      netPaise: 3_560_000,
      deductions: [{ kind: 'PENALTY', rateBps: 1000, basisPaise: 4_000_000, amountPaise: 400_000 }],
      lines: [{ tdsSection: '194C', tdsRateBps: 100 }],
    });
    const again = await post('finance', '/admin/payouts/batches', { kind: 'OFF_CYCLE' });
    expect([again.status, again.json.error.code]).toEqual([409, 'DRAFT_EXISTS']);
    const early = await post('finance', `/admin/payouts/batches/${draft.json.data.id}/bank-file`, {
      code: code(),
    });
    expect([early.status, early.json.error.code]).toEqual([409, 'NOT_EXPORTED']);

    const discarded = await post('finance', `/admin/payouts/batches/${draft.json.data.id}/discard`);
    expect(discarded.json.data).toMatchObject({ discarded: true, reference: 'PO20261214W' });
    expect(await payout()).toMatchObject({ batch_id: null, net: '4000000', tds: '0' });
    expect(await e2e.db.sql`SELECT 1 FROM payout_deductions`).toHaveLength(0);

    const made = await post('finance', '/admin/payouts/batches', { kind: 'WEEKLY' });
    expect(made.status).toBe(201);
    batchId = made.json.data.id;
  });

  it('export: amounts lock, the vendor invoice and the ledger are written, each txn balanced', async () => {
    // Audit H2: a fresh authenticator code, or nothing happens.
    const noCode = await post('finance', `/admin/payouts/batches/${batchId}/export`, {});
    expect(noCode.status).toBe(400);
    const wrong = await post('finance', `/admin/payouts/batches/${batchId}/export`, {
      code: '000000',
    });
    expect([wrong.status, wrong.json.error.code]).toEqual([422, 'STEP_UP_CODE_INVALID']);
    expect((await payout()).status).toBe('PENDING');
    const res = await post('finance', `/admin/payouts/batches/${batchId}/export`, { code: code() });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ state: 'EXPORTED', transfersReady: 1 });
    expect(res.json.data.transfers[0]).toMatchObject({
      reference: 'PO20261214W001',
      state: 'READY_FOR_BANK_FILE',
    });
    const p = await payout();
    expect(p.status).toBe('APPROVED');
    const notSent = await post('finance', `/admin/payouts/batches/${batchId}/mark-paid`, {
      code: code(),
      transfers: [{ photographerId: proId, utr: 'HDFCN26121400001' }],
    });
    expect([notSent.status, notSent.json.error.code]).toEqual([409, 'NOT_IN_BANK_FILE']);
    expect(p.vendor_invoice_id).not.toBeNull();
    const ledger = await e2e.db.sql<{ txn_kind: string; account: string; net: string }[]>`
      SELECT txn_kind, account,
             sum(CASE WHEN direction = 'DEBIT' THEN amount_paise ELSE -amount_paise END)::text AS net
      FROM ledger_entries WHERE payout_id = ${p.id} GROUP BY txn_kind, account ORDER BY txn_kind, account`;
    expect(ledger).toEqual([
      { txn_kind: 'PAYOUT_ACCRUED', account: 'COGS_VENDOR', net: '4000000' },
      { txn_kind: 'PAYOUT_ACCRUED', account: 'VENDOR_PAYABLE', net: '-4000000' },
      { txn_kind: 'PAYOUT_DEDUCTION', account: 'VENDOR_DEDUCTIONS', net: '-400000' },
      { txn_kind: 'PAYOUT_DEDUCTION', account: 'VENDOR_PAYABLE', net: '400000' },
      { txn_kind: 'PAYOUT_DEDUCTION', account: 'VENDOR_RECOVERABLE', net: '0' },
      { txn_kind: 'TDS_WITHHELD', account: 'TDS_PAYABLE', net: '-40000' },
      { txn_kind: 'TDS_WITHHELD', account: 'VENDOR_PAYABLE', net: '40000' },
    ]);
    const twice = await post('finance', `/admin/payouts/batches/${batchId}/export`, {
      code: code(),
    });
    expect([twice.status, twice.json.error.code]).toEqual([409, 'ALREADY_EXPORTED']);
  });

  it('the bank file: full account number in the file only, audited, and never written twice', async () => {
    const noCode = await post('finance', `/admin/payouts/batches/${batchId}/bank-file`);
    expect(noCode.status).toBe(400);
    const res = await post('finance', `/admin/payouts/batches/${batchId}/bank-file`, {
      code: code(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.json.data).toMatchObject({
      filename: 'PO20261214W-bank-file-001.csv',
      rowCount: 1,
      totalPaise: '3560000',
    });
    expect(res.json.data.content).toContain(
      `NEFT,Asha Patel,${ACCOUNT},HDFC0001234,35600.00,PO20261214W001,Clickco payout PO20261214W`,
    );
    const detail = await get('finance', `/admin/payouts/batches/${batchId}`);
    expect(JSON.stringify(detail.json)).not.toContain(ACCOUNT);
    expect(await audits('payout_batch.bank_file')).toEqual([
      {
        entity_id: batchId,
        after_state: { references: ['PO20261214W001'], rows: 1, total_paise: '3560000' },
      },
    ]);
    // A second file would pay everyone again: refused, and the account number is never stored.
    const again = await post('finance', `/admin/payouts/batches/${batchId}/bank-file`, {
      code: code(),
    });
    expect([again.status, again.json.error.code]).toEqual([409, 'NOTHING_NEW']);
    expect((await payout()).status).toBe('PROCESSING');
    expect(detail.json.data.transfers[0].sentBy).toEqual({
      id: staff.finance,
      name: 'Test FINANCE',
    });
    const stored = await e2e.db.sql`
      SELECT 1 FROM idempotency_keys WHERE response_body::text LIKE ${`%${ACCOUNT}%`}`;
    expect(stored).toHaveLength(0);
  });

  it('a returned transfer is marked failed, sent again, then paid with its UTR', async () => {
    const failPath = `/admin/payouts/batches/${batchId}/mark-failed`;
    const failure = { photographerId: proId, reason: 'Account frozen by the bank' };
    // Audit H2: the bank's return reference is required …
    const noRef = await post('finance2', failPath, { ...failure, code: code() });
    expect(noRef.status).toBe(400);
    // … and whoever made the bank file cannot declare it failed (maker–checker), checked
    // before their code is spent.
    const maker = await post('finance', failPath, {
      ...failure,
      bankReference: 'RET2612140001',
      code: '000000',
    });
    expect([maker.status, maker.json.error.code]).toEqual([403, 'SECOND_PERSON_REQUIRED']);
    const failed = await post('finance2', failPath, {
      ...failure,
      bankReference: 'ret2612140001',
      code: code(),
    });
    expect(failed.status).toBe(200);
    expect(failed.json.data.transfers[0]).toMatchObject({
      state: 'FAILED',
      failureReason: 'Account frozen by the bank',
      failureReference: 'RET2612140001',
    });
    const file = await post('finance', `/admin/payouts/batches/${batchId}/bank-file`, {
      code: code(),
    });
    expect([file.status, file.json.error.code]).toEqual([409, 'NOTHING_NEW']);
    const leaky = await post('finance2', failPath, {
      photographerId: proId,
      reason: `Bank says account ${ACCOUNT} is closed`,
      bankReference: 'RET2612140002',
      code: code(),
    });
    expect(leaky.status).toBe(400);
    const early = await post('finance', `/admin/payouts/batches/${batchId}/mark-paid`, {
      code: code(),
      transfers: [{ photographerId: proId, utr: 'HDFCN26121412345' }],
    });
    expect([early.status, early.json.error.code]).toEqual([409, 'TRANSFER_FAILED']);

    const retryPath = `/admin/payouts/batches/${batchId}/retry`;
    const makerRetry = await post('finance', retryPath, { photographerId: proId, code: code() });
    expect([makerRetry.status, makerRetry.json.error.code]).toEqual([
      403,
      'SECOND_PERSON_REQUIRED',
    ]);
    const retried = await post('finance2', retryPath, { photographerId: proId, code: code() });
    expect(retried.json.data.transfers[0]).toMatchObject({
      state: 'READY_FOR_BANK_FILE',
      reference: 'PO20261214W001R1',
    });
    // Sent again within 7 days of the original file: ops is alerted (the first may still land).
    const alerts = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events
      WHERE event_type = 'ops.alert' AND aggregate_id = ${batchId}`;
    expect(alerts.map((a) => a.payload)).toEqual([
      expect.objectContaining({
        severity: 'HIGH',
        source_event_type: 'payout.early_resend',
        details: expect.objectContaining({
          photographer_id: proId,
          reference: 'PO20261214W001R1',
          bank_reference: 'RET2612140001',
          sent_again_by: staff.finance2,
        }),
      }),
    ]);
    const resend = await post('finance', `/admin/payouts/batches/${batchId}/bank-file`, {
      code: code(),
    });
    expect(resend.json.data).toMatchObject({
      filename: 'PO20261214W-bank-file-001R1.csv',
      rowCount: 1,
    });
    expect(resend.json.data.content).toContain(',PO20261214W001R1,');

    const paid = await post('finance', `/admin/payouts/batches/${batchId}/mark-paid`, {
      code: code(),
      transfers: [{ photographerId: proId, utr: 'hdfcn26121412345' }],
    });
    expect(paid.status).toBe(200);
    expect(paid.json.data).toMatchObject({ state: 'PAID', transfersPaid: 1 });
    expect(paid.json.data.transfers[0]).toMatchObject({ state: 'PAID', utr: 'HDFCN26121412345' });
    const [payable] = await e2e.db.sql<{ n: string }[]>`
      SELECT sum(CASE WHEN direction = 'DEBIT' THEN amount_paise ELSE -amount_paise END)::text AS n
      FROM ledger_entries WHERE payout_id = ${(await payout()).id} AND account = 'VENDOR_PAYABLE'`;
    expect(payable?.n).toBe('0');
    const repeat = await post('finance', `/admin/payouts/batches/${batchId}/mark-paid`, {
      code: code(),
      transfers: [{ photographerId: proId, utr: 'HDFCN26121412345' }],
    });
    expect(repeat.status).toBe(200);
    const other = await post('finance', `/admin/payouts/batches/${batchId}/mark-paid`, {
      code: code(),
      transfers: [{ photographerId: proId, utr: 'OTHERUTR999' }],
    });
    expect([other.status, other.json.error.code]).toEqual([409, 'ALREADY_PAID']);
    expect(
      (await e2e.db.sql`SELECT 1 FROM domain_events WHERE event_type = 'payout_batch.paid'`).length,
    ).toBe(1);
  });

  it('audit L7: a UTR can never be recorded on another transfer, even by SQL', async () => {
    const otherPro = await insertPhotographer(e2e.db.sql, {
      phone: '+919825079402',
      name: 'Ravi Shah',
      km: 4,
      categories: [{ code: 'PORTRAIT', tier: 'EXPERT' }],
    });
    const reuse = e2e.db.sql`
      INSERT INTO payouts (booking_id, photographer_id, gross_paise, net_paise, status, utr)
      VALUES (${bookingId}, ${otherPro}, 100, 100, 'PAID', 'HDFCN26121412345')`;
    await expect(reuse).rejects.toMatchObject({ code: '23P01' });
  });

  it('the self-billed statement and the monthly TDS report', async () => {
    const st = await get('finance', `/admin/payouts/batches/${batchId}/statements/${proId}`);
    expect(st.json.data.filename).toBe('PO20261214W001R1-statement.csv');
    expect(st.json.data.content).toContain(PAN);
    expect(st.json.data.content).toContain('Paid to your bank,35600.00');
    expect(st.json.data.content).toContain('HDFCN26121412345');

    const tds = await get('finance', '/admin/payouts/tds');
    expect(tds.json.data.financialYear).toBe('2026-27');
    expect(tds.json.data.tdsPaise).toBe('40000');
    expect(tds.json.data.months.find((m: Json) => m.month === '2026-12')).toEqual({
      month: '2026-12',
      payeeCount: 1,
      payoutCount: 1,
      grossPaise: '4000000',
      tdsPaise: '40000',
      depositDueOn: '2027-01-07',
    });
    const report = await get('finance', '/admin/payouts/tds/2026-12/report');
    expect(report.json.data).toMatchObject({
      filename: 'tds-194C-2026-12.csv',
      totalPaise: '40000',
    });
    expect(report.json.data.content).toContain(
      `Asha Patel,${PAN},194C,1%,40000.00,400.00,2026-12-14`,
    );
    expect((await get('finance', '/admin/payouts/tds/2026-13/report')).status).toBe(400);
    expect(await audits('payout.tds_report_downloaded')).toHaveLength(1);
    expect(await audits('payout.statement_downloaded')).toHaveLength(1);
  });

  it('every decision wrote its audit row; the batch list shows it; the week is done', async () => {
    for (const action of [
      'payout_batch.create',
      'payout_batch.discard',
      'payout_batch.export',
      'payout_batch.bank_file',
      'payout_batch.mark_failed',
      'payout_batch.retry',
      'payout_batch.mark_paid',
    ]) {
      expect((await audits(action)).length, action).toBeGreaterThan(0);
    }
    const list = await get('finance', '/admin/payouts/batches?limit=1');
    expect(list.json.data.items.map((b: Json) => [b.reference, b.state])).toEqual([
      ['PO20261214W', 'PAID'],
    ]);
    const due = await get('finance', '/admin/payouts/due');
    expect(due.json.data.nextBatchKind).toBe('OFF_CYCLE');
    expect(due.json.data.nextWeeklyRunOn).toBe('2026-12-21');
    expect(await e2e.get(PayoutsService).overviewCount(e2e.now())).toEqual({
      dueThisWeek: { payoutCount: 0, grossPaise: 0n },
      batchesAwaitingPayment: 0,
    });
  });
});
