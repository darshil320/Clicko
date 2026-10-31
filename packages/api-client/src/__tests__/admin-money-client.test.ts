import { describe, expect, it, vi } from 'vitest';
import { createAdminApiClient } from '../admin-client.js';
import { isApiError } from '../errors.js';
import { fail, memoryTokens, mockFetch, ok, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
const EVENT = '9f1b5e3c-4d6a-4eaf-9b32-3c4d5e6f7081';

const actor = { id: UUID_2, name: 'Aisha Khan' };
const refund = (overrides: Record<string, unknown> = {}) => ({
  id: UUID,
  bookingId: UUID_2,
  reference: 'CLK-4821',
  cityName: 'Surat',
  clientName: 'Priya Sharma',
  bookingTotalPaise: 1_690_822,
  paymentId: UUID_2,
  paidWith: 'UPI · priya@okicici',
  amountPaise: 250_000,
  status: 'REQUESTED',
  reason: 'GOODWILL',
  note: 'Client asked nicely',
  requestedBy: actor,
  requestedAt: '2026-10-30T10:00:00+05:30',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  completedAt: null,
  failureReason: null,
  creditNotes: [],
  canDecide: true,
  blockedReason: null,
  creditNoteLate: false,
  needsAuthenticatorCode: false,
  ...overrides,
});
const review = {
  eventId: EVENT,
  reason: 'REFUND_DUE_NO_SHOW',
  title: 'Photographer did not show up',
  raisedAt: '2026-10-30T10:00:00+05:30',
  bookingId: UUID_2,
  reference: 'CLK-4821',
  cityName: 'Surat',
  clientName: 'Priya Sharma',
  bookingStatus: 'PRO_NO_SHOW',
  bookingTotalPaise: 1_690_822,
  paidPaise: 845_411,
  refundablePaise: 845_411,
  paymentId: UUID,
  breach: null,
  suggestion: {
    outcome: 'REFUND_REQUESTED',
    amountPaise: 845_411,
    creditPaise: 50_000,
    refundReason: 'PRO_NO_SHOW',
    creditReason: null,
    why: 'Full refund plus a ₹500 credit',
  },
  resolution: null,
};

function client(reply: Parameters<typeof mockFetch>[0]) {
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch(reply);
  const api = createAdminApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired: vi.fn() });
  return { api, calls };
}

async function rejection(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('adminMoneyRoutes (ADR-0026 D1/D2)', () => {
  it('lists refunds by tab with the staff token and a validated page', async () => {
    const { api, calls } = client(() => ok({ items: [refund()], nextCursor: null }));
    const page = await api.money.refunds.list({ status: 'IN_PROGRESS', limit: 20 });
    expect(page.items[0]?.paidWith).toBe('UPI · priya@okicici');
    expect(calls[0]?.url).toBe(`${BASE}/admin/refunds?limit=20&status=IN_PROGRESS`);
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
  });

  it('asks for a refund on a booking with an Idempotency-Key, body checked first', async () => {
    const { api, calls } = client(() => ok({ refunds: [refund()] }, 201));
    await api.money.refunds.request(
      UUID_2,
      { amountPaise: 250_000, reason: 'GOODWILL', note: 'Client asked nicely' },
      { idempotencyKey: KEY },
    );
    expect(calls[0]).toMatchObject({
      url: `${BASE}/admin/bookings/${UUID_2}/refunds`,
      method: 'POST',
      body: { amountPaise: 250_000, reason: 'GOODWILL', note: 'Client asked nicely' },
    });
    expect(calls[0]?.headers['idempotency-key']).toBe(KEY);
    const bad = await rejection(() =>
      api.money.refunds.request(
        UUID_2,
        { amountPaise: 0, reason: 'GOODWILL', note: 'x' },
        { idempotencyKey: KEY },
      ),
    );
    expect(bad.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(1);
  });

  it('approves, rejects and retries at the refund path; never sends a bad id', async () => {
    const { api, calls } = client(() => ok(refund({ status: 'COMPLETED' })));
    await api.money.refunds.approve(UUID, { note: 'OK' }, { idempotencyKey: KEY });
    await api.money.refunds.reject(UUID, { note: 'Not owed' }, { idempotencyKey: KEY });
    await api.money.refunds.retry(UUID, { idempotencyKey: KEY });
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/admin/refunds/${UUID}/approve`,
      `${BASE}/admin/refunds/${UUID}/reject`,
      `${BASE}/admin/refunds/${UUID}/retry`,
    ]);
    const err = await rejection(() =>
      api.money.refunds.approve('../staff', {}, { idempotencyKey: KEY }),
    );
    expect(err.code).toBe('INVALID_ID');
  });

  it('surfaces the server’s four-eyes refusal as an ApiError', async () => {
    const { api } = client(() => fail(409, 'FOUR_EYES', 'Someone else has to approve it.'));
    const err = await rejection(() => api.money.refunds.approve(UUID, {}, { idempotencyKey: KEY }));
    expect([err.status, err.code]).toEqual([409, 'FOUR_EYES']);
  });

  it('refuses an answer that does not match the contract', async () => {
    const { api } = client(() => ok({ items: [{ id: 'nope' }], nextCursor: null }));
    await expect(api.money.refunds.list()).rejects.toThrow();
  });

  it('reads a booking’s money and issues credits', async () => {
    const credit = {
      id: UUID,
      bookingId: UUID_2,
      reference: 'CLK-4821',
      clientName: 'Priya Sharma',
      amountPaise: 50_000,
      usedPaise: 0,
      reason: 'GOODWILL',
      note: 'Sorry',
      issuedBy: actor,
      issuedAt: '2026-10-30T10:00:00+05:30',
      expiresAt: '2027-10-30T23:59:59+05:30',
    };
    const { api, calls } = client((call) =>
      call.url.endsWith('/money')
        ? ok({
            bookingId: UUID_2,
            reference: 'CLK-4821',
            clientName: 'Priya Sharma',
            totalPaise: 1_690_822,
            paidPaise: 845_411,
            refundedPaise: 0,
            inFlightPaise: 0,
            refundablePaise: 845_411,
            creditedPaise: 0,
            qmLimitPaise: 500_000,
            payments: [],
            refunds: [],
            credits: [],
          })
        : call.method === 'GET'
          ? ok({ items: [credit], nextCursor: null })
          : ok(credit, 201),
    );
    expect((await api.money.bookingMoney(UUID_2)).qmLimitPaise).toBe(500_000);
    await api.money.credits.issue(
      UUID_2,
      { amountPaise: 50_000, reason: 'GOODWILL', note: 'Sorry for the wait' },
      { idempotencyKey: KEY },
    );
    // Audit L8: a large credit carries the issuer's code and a co-approver's.
    await api.money.credits.issue(
      UUID_2,
      {
        amountPaise: 600_000,
        reason: 'QUALITY',
        note: 'Big apology',
        code: '123456',
        coApprover: { email: ' Admin@Clickco.test ', code: '654321' },
      },
      { idempotencyKey: KEY },
    );
    expect(calls[2]?.body).toMatchObject({
      code: '123456',
      coApprover: { email: 'admin@clickco.test', code: '654321' },
    });
    const badCo = await rejection(() =>
      api.money.credits.issue(
        UUID_2,
        {
          amountPaise: 600_000,
          reason: 'QUALITY',
          note: 'Big apology',
          code: '123456',
          coApprover: { email: 'not-an-email', code: '654321' },
        },
        { idempotencyKey: KEY },
      ),
    );
    expect(badCo.code).toBe('INVALID_INPUT');
    await api.money.credits.list({ bookingId: UUID_2 });
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/admin/bookings/${UUID_2}/money`,
      `${BASE}/admin/bookings/${UUID_2}/credits`,
      `${BASE}/admin/bookings/${UUID_2}/credits`,
      `${BASE}/admin/credits?limit=50&bookingId=${UUID_2}`,
    ]);
  });

  it('lists review items and settles one with its outcome', async () => {
    const { api, calls } = client((call) =>
      call.method === 'GET' ? ok({ items: [review], nextCursor: null }) : ok(review),
    );
    const page = await api.money.reviews.list({ status: 'SETTLED' });
    expect(page.items[0]?.suggestion.creditPaise).toBe(50_000);
    await api.money.reviews.settle(
      EVENT,
      { outcome: 'NO_ACTION', note: 'Client declined' },
      { idempotencyKey: KEY },
    );
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/admin/reviews?limit=50&status=SETTLED`,
      `${BASE}/admin/reviews/${EVENT}/settle`,
    ]);
    const bad = await rejection(() =>
      api.money.reviews.settle(EVENT, { outcome: 'CHARGE_RAISED', note: 'x' } as never, {
        idempotencyKey: KEY,
      }),
    );
    expect(bad.code).toBe('INVALID_INPUT');
  });
});
