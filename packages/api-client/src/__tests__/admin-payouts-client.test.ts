import { describe, expect, it, vi } from 'vitest';
import { createAdminApiClient } from '../admin-client.js';
import { isApiError } from '../errors.js';
import { memoryTokens, mockFetch, ok, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = { idempotencyKey: '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b' };

const summary = {
  id: UUID,
  reference: 'PO20261214W',
  kind: 'WEEKLY',
  state: 'EXPORTED',
  createdAt: '2026-12-14T10:00:00+05:30',
  cutoffAt: '2026-12-14T10:00:00+05:30',
  exportedAt: '2026-12-14T10:05:00+05:30',
  paidAt: null,
  payeeCount: 1,
  payoutCount: 1,
  transfersReady: 0,
  transfersAwaiting: 1,
  transfersPaid: 0,
  transfersFailed: 0,
  grossPaise: '4000000',
  deductionsPaise: '400000',
  tdsPaise: '40000',
  netPaise: '3560000',
};
const detail = {
  ...summary,
  transfers: [
    {
      photographerId: UUID_2,
      name: 'Asha Patel',
      reference: 'PO20261214W001',
      state: 'AWAITING_PAYMENT',
      bank: {
        holder: 'Asha Patel',
        bankName: null,
        ifsc: 'HDFC0001234',
        last4: '7890',
        verified: true,
      },
      pan: { masked: 'XXXXXX234F', valid: true },
      grossPaise: 4_000_000,
      deductionsPaise: 400_000,
      tdsPaise: 40_000,
      netPaise: 3_560_000,
      broughtForwardPaise: 0,
      carriedForwardPaise: 0,
      utr: null,
      paidAt: null,
      failureReason: null,
      failureReference: null,
      sentBy: null,
      sentAt: null,
      lines: [],
      deductions: [],
    },
  ],
};
const csvFile = {
  filename: 'PO20261214W-bank-file.csv',
  contentType: 'text/csv',
  content: 'Payment Type\r\n',
  rowCount: 1,
  totalPaise: '3560000',
};

function client(reply: Parameters<typeof mockFetch>[0]) {
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch(reply);
  const api = createAdminApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired: vi.fn() });
  return { api, calls };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('createAdminApiClient().payouts (ADR-0026 D3)', () => {
  it('batch totals arrive as bigint (aggregates never travel as numbers)', async () => {
    const { api, calls } = client(() => ok(detail));
    const res = await api.payouts.batches.get(UUID);
    expect(res.netPaise).toBe(3_560_000n);
    expect(res.transfers[0]?.netPaise).toBe(3_560_000);
    expect(calls[0]?.url).toBe(`${BASE}/admin/payouts/batches/${UUID}`);
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
  });

  it('creates a draft with an Idempotency-Key, validating the body first', async () => {
    const { api, calls } = client(() => ok(detail, 201));
    await api.payouts.batches.create({ kind: 'WEEKLY' }, KEY);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/admin/payouts/batches`,
      body: { kind: 'WEEKLY' },
    });
    expect(calls[0]?.headers['idempotency-key']).toBe(KEY.idempotencyKey);
    const bad = await rejection(api.payouts.batches.create({ kind: 'DAILY' as 'WEEKLY' }, KEY));
    expect(bad.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(1);
  });

  it('mark paid: UTRs are trimmed and upper-cased; a bad one never leaves the browser', async () => {
    const { api, calls } = client(() => ok(detail));
    await api.payouts.batches.markPaid(
      UUID,
      { code: '123456', transfers: [{ photographerId: UUID_2, utr: ' hdfcn26121412345 ' }] },
      KEY,
    );
    expect(calls[0]?.url).toBe(`${BASE}/admin/payouts/batches/${UUID}/mark-paid`);
    expect(calls[0]?.body).toEqual({
      code: '123456',
      transfers: [{ photographerId: UUID_2, utr: 'HDFCN26121412345' }],
    });
    const bad = await rejection(
      api.payouts.batches.markPaid(
        UUID,
        { code: '123456', transfers: [{ photographerId: UUID_2, utr: 'x-1' }] },
        KEY,
      ),
    );
    expect(bad.message).toMatch(/UTR/);
    const twice = await rejection(
      api.payouts.batches.markPaid(
        UUID,
        {
          code: '123456',
          transfers: [
            { photographerId: UUID_2, utr: 'AAAAAA1' },
            { photographerId: UUID_2, utr: 'AAAAAA2' },
          ],
        },
        KEY,
      ),
    );
    expect(twice.code).toBe('INVALID_INPUT');
  });

  it('export, discard, fail and retry hit their routes', async () => {
    const { api, calls } = client((call) =>
      call.url.endsWith('/discard')
        ? ok({ id: UUID, reference: 'PO20261214W', discarded: true })
        : ok(detail),
    );
    await api.payouts.batches.export(UUID, { code: '123456' }, KEY);
    await api.payouts.batches.discard(UUID, KEY);
    await api.payouts.batches.markFailed(
      UUID,
      {
        code: '234567',
        photographerId: UUID_2,
        reason: 'Account frozen',
        bankReference: ' ret2612140001 ',
      },
      KEY,
    );
    await api.payouts.batches.retry(UUID, { code: '345678', photographerId: UUID_2 }, KEY);
    expect(calls.map((c) => c.url.replace(`${BASE}/admin/payouts/batches/${UUID}`, ''))).toEqual([
      '/export',
      '/discard',
      '/mark-failed',
      '/retry',
    ]);
    expect(calls[2]?.body).toMatchObject({ bankReference: 'RET2612140001', code: '234567' });
  });

  it('audit H2: no authenticator code or no bank return reference never leaves the browser', async () => {
    const { api, calls } = client(() => ok(detail));
    const noCode = await rejection(api.payouts.batches.export(UUID, { code: '12' }, KEY));
    expect(noCode.code).toBe('INVALID_INPUT');
    const noRef = await rejection(
      api.payouts.batches.markFailed(
        UUID,
        { code: '123456', photographerId: UUID_2, reason: 'Frozen', bankReference: '' },
        KEY,
      ),
    );
    expect(noRef.message).toMatch(/return or rejection reference/);
    const noFileCode = await rejection(api.payouts.batches.createBankFile(UUID, { code: '' }, KEY));
    expect(noFileCode.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('files come back as CSV text in the envelope', async () => {
    const { api, calls } = client(() => ok(csvFile));
    const file = await api.payouts.batches.createBankFile(UUID, { code: '123456' }, KEY);
    expect(file).toMatchObject({ contentType: 'text/csv', totalPaise: 3_560_000n });
    await api.payouts.batches.statement(UUID, UUID_2);
    await api.payouts.tds.report('2026-12');
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/admin/payouts/batches/${UUID}/bank-file`,
      `${BASE}/admin/payouts/batches/${UUID}/statements/${UUID_2}`,
      `${BASE}/admin/payouts/tds/2026-12/report`,
    ]);
    expect((await rejection(api.payouts.tds.report('2026-13'))).code).toBe('INVALID_INPUT');
    expect((await rejection(api.payouts.batches.statement(UUID, '../x'))).code).toBe('INVALID_ID');
  });

  it('lists batches with a cursor, and TDS by financial year', async () => {
    const { api, calls } = client((call) =>
      call.url.includes('/tds')
        ? ok({
            financialYear: '2026-27',
            rules: {
              section: '194C',
              individualRateBps: 100,
              otherRateBps: 200,
              noPanRateBps: 2000,
              singlePaymentLimitPaise: 3_000_000,
              yearlyLimitPaise: 10_000_000,
            },
            months: [],
            grossPaise: '0',
            tdsPaise: '0',
            financialYears: ['2026-27'],
          })
        : ok({ items: [summary], nextCursor: null }),
    );
    const page = await api.payouts.batches.list({ cursor: 'abc', limit: 20 });
    expect(page.items[0]?.grossPaise).toBe(4_000_000n);
    await api.payouts.tds.summary({ fy: '2026-27' });
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/admin/payouts/batches?cursor=abc&limit=20`,
      `${BASE}/admin/payouts/tds?fy=2026-27`,
    ]);
    expect((await rejection(api.payouts.tds.summary({ fy: '2026-28' }))).code).toBe(
      'INVALID_INPUT',
    );
  });
});
