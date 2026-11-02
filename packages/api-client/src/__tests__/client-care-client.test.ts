import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client.js';
import { isApiError } from '../errors.js';
import { createProApiClient } from '../pro-client.js';
import { fail, memoryTokens, mockFetch, ok, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
const AT = '2026-12-07T10:00:00+05:30';

const ticket = {
  id: UUID,
  reference: 'TKT-1042',
  category: 'BILLING',
  subject: 'Billing · CLK-1004',
  bookingId: UUID_2,
  status: 'OPEN',
  receivedAt: AT,
  ackDueAt: '2026-12-09T10:00:00+05:30',
  acknowledgedAt: null,
  resolveDueAt: '2027-01-06T10:00:00+05:30',
  resolvedAt: null,
  resolutionSummary: null,
};

const money = {
  bookingId: UUID_2,
  refunds: [
    {
      id: UUID,
      amountPaise: 100_000,
      status: 'REFUNDED',
      initiatedAt: AT,
      completedAt: AT,
    },
  ],
  credits: [
    {
      id: UUID_2,
      amountPaise: 50_000,
      remainingPaise: 20_000,
      reason: 'GOODWILL',
      issuedAt: AT,
      expiresAt: '2027-12-07T23:59:59+05:30',
      expired: false,
    },
  ],
};

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

function clientApi(reply: Parameters<typeof mockFetch>[0]) {
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch(reply);
  return { api: createApiClient({ baseUrl: BASE, fetch, tokens }), calls };
}

describe('client money and care (ADR-0027 D5)', () => {
  it('reads the refunds and credits on my booking', async () => {
    const { api, calls } = clientApi(() => ok(money));
    expect(await api.bookings.money(UUID_2)).toEqual(money);
    expect(calls[0]).toMatchObject({ url: `${BASE}/bookings/${UUID_2}/money`, method: 'GET' });
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
  });

  it('never puts a non-uuid booking id in a path', async () => {
    const { api, calls } = clientApi(() => ok(money));
    expect(await rejection(api.bookings.money('../admin'))).toMatchObject({ code: 'INVALID_ID' });
    expect(
      await rejection(
        api.care.reportQualityIssue(
          '../x',
          { complaint: 'Blurry photos' },
          { idempotencyKey: KEY },
        ),
      ),
    ).toMatchObject({ code: 'INVALID_ID' });
    expect(calls).toHaveLength(0);
  });

  it('raises a ticket with an Idempotency-Key and lists mine', async () => {
    const replies = [ok(ticket, 201), ok([ticket])];
    const { api, calls } = clientApi(() => replies.shift() ?? ok(null));
    const body = {
      bookingId: UUID_2,
      category: 'BILLING',
      message: 'I was charged twice.',
    } as const;
    expect(await api.care.raiseTicket(body, { idempotencyKey: KEY })).toEqual(ticket);
    expect(await api.care.tickets()).toEqual([ticket]);
    expect(calls[0]).toMatchObject({ url: `${BASE}/me/tickets`, method: 'POST', body });
    expect(calls[0]?.headers['idempotency-key']).toBe(KEY);
    expect(calls[1]).toMatchObject({ url: `${BASE}/me/tickets`, method: 'GET' });
  });

  it('surfaces the daily ticket cap and the quality window as codes', async () => {
    const replies = [
      fail(429, 'RATE_LIMITED', 'Too many tickets today'),
      fail(409, 'QUALITY_WINDOW_CLOSED', 'Up to 30 days after delivery'),
    ];
    const { api, calls } = clientApi(() => replies.shift() ?? ok(null));
    const capped = await rejection(
      api.care.raiseTicket(
        { category: 'OTHER', message: 'One more question' },
        { idempotencyKey: KEY },
      ),
    );
    expect(capped).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    const late = await rejection(
      api.care.reportQualityIssue(UUID_2, { complaint: 'Blurry photos' }, { idempotencyKey: KEY }),
    );
    expect(late).toMatchObject({ status: 409, code: 'QUALITY_WINDOW_CLOSED' });
    expect(calls[1]).toMatchObject({
      url: `${BASE}/bookings/${UUID_2}/quality-issue`,
      method: 'POST',
      body: { complaint: 'Blurry photos' },
    });
  });

  it('reports a quality issue on a delivered booking', async () => {
    const issue = { id: UUID, bookingId: UUID_2, status: 'OPEN', raisedAt: AT };
    const { api } = clientApi(() => ok(issue, 201));
    expect(
      await api.care.reportQualityIssue(
        UUID_2,
        { complaint: 'Half the photos are blurry.' },
        { idempotencyKey: KEY },
      ),
    ).toEqual(issue);
  });
});

describe('Pro earnings: paid transfers with TDS (ADR-0027 D5)', () => {
  const earnings = {
    basis: 'EXPECTED',
    asOf: AT,
    todayPaise: 0,
    weekPaise: 0,
    monthPaise: 520_000,
    pendingPayoutPaise: 0,
    jobs: [],
    paidTransfers: [
      {
        batchReference: 'PO20261214W',
        paidAt: AT,
        payoutCount: 2,
        grossPaise: 4_520_000,
        deductionsPaise: 0,
        tdsPaise: 40_000,
        netPaise: 4_480_000,
        utrLast4: '0077',
      },
    ],
  };

  it('parses the paid transfers; an older answer without them still parses', async () => {
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    const replies = [ok(earnings), ok({ ...earnings, paidTransfers: undefined })];
    const { fetch } = mockFetch(() => replies.shift() ?? ok(null));
    const api = createProApiClient({ baseUrl: BASE, fetch, tokens });
    expect((await api.earnings()).paidTransfers?.[0]).toMatchObject({
      tdsPaise: 40_000,
      utrLast4: '0077',
    });
    expect((await api.earnings()).paidTransfers).toBeUndefined();
  });

  it('refuses a full UTR where only the last 4 belong', async () => {
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    const leaked = {
      ...earnings,
      paidTransfers: [{ ...earnings.paidTransfers[0], utrLast4: 'HDFCN26121400077' }],
    };
    const { fetch } = mockFetch(() => ok(leaked));
    const api = createProApiClient({ baseUrl: BASE, fetch, tokens });
    await expect(api.earnings()).rejects.toBeDefined();
  });
});
