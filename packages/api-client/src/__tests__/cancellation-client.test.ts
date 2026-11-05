import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client.js';
import { isApiError } from '../errors.js';
import { fail, memoryTokens, mockFetch, ok, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b';

const quote = {
  bookingId: UUID,
  cancellable: true,
  blockedBy: null,
  band: 'HOURS_24_TO_72',
  clause: '3.1',
  reason: 'You are cancelling 24 to 72 hours before the shoot, so half of your advance comes back.',
  peakSeason: false,
  paidPaise: 501_500,
  refundPaise: 250_750,
  keptPaise: 250_750,
  heldPaise: 0,
  refundBps: 5_000,
  changesAt: '2027-03-11T04:30:00.000Z',
  quotedAt: '2027-03-10T04:30:00.000Z',
};

const cancelled = {
  id: UUID,
  reference: 'CLK-1042',
  status: 'CANCELLED_CLIENT',
  tier: 'PROFESSIONAL',
  categoryCode: 'FOOD',
  cityName: 'Surat',
  scheduledStart: '2027-03-12T04:30:00.000Z',
  scheduledHours: 2,
  emergencyBand: 'NONE',
  venueAddress: '4 Athwalines, Surat',
  totalPaise: 1_003_000,
  advancePaise: 501_500,
  balancePaise: 501_500,
  amountPaidPaise: 501_500,
  quoteExpiresAt: null,
  createdAt: '2027-02-24T04:30:00.000Z',
  cancellation: {
    band: 'HOURS_24_TO_72',
    clause: '3.1',
    refundPaise: 250_750,
    keptPaise: 250_750,
    heldPaise: 0,
    refundBps: 5_000,
    peakSeason: false,
    refundIds: [UUID_2],
    cancelledAt: '2027-03-10T04:30:00.000Z',
  },
};

function clientApi(reply: Parameters<typeof mockFetch>[0]) {
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch(reply);
  return { api: createApiClient({ baseUrl: BASE, fetch, tokens }), calls };
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

describe('client cancellation (T&C §3 ladder)', () => {
  it('quotes what cancelling now returns', async () => {
    const { api, calls } = clientApi(() => ok(quote));
    expect(await api.bookings.cancellationQuote(UUID)).toEqual(quote);
    expect(calls[0]).toMatchObject({ url: `${BASE}/bookings/${UUID}/cancellation`, method: 'GET' });
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
  });

  it('cancels against the confirmed refund, with the idempotency key', async () => {
    const { api, calls } = clientApi(() => ok(cancelled));
    const res = await api.bookings.cancel(
      UUID,
      { idempotencyKey: KEY },
      { expectedRefundPaise: 250_750 },
    );
    expect(res.cancellation.refundPaise).toBe(250_750);
    expect(calls[0]).toMatchObject({
      url: `${BASE}/bookings/${UUID}/cancel`,
      method: 'POST',
      body: { expectedRefundPaise: 250_750 },
    });
    expect(calls[0]?.headers['idempotency-key']).toBe(KEY);
  });

  it('before payment the cancel still needs no body', async () => {
    const { api, calls } = clientApi(() => ok(cancelled));
    await api.bookings.cancel(UUID, { idempotencyKey: KEY });
    expect(calls[0]?.body).toBeUndefined();
  });

  it('a changed band surfaces as CANCELLATION_TERMS_CHANGED', async () => {
    const { api } = clientApi(() =>
      fail(409, 'CANCELLATION_TERMS_CHANGED', 'Cancelling now returns ₹0.'),
    );
    const err = await rejection(
      api.bookings.cancel(UUID, { idempotencyKey: KEY }, { expectedRefundPaise: 250_750 }),
    );
    expect(err).toMatchObject({ status: 409, code: 'CANCELLATION_TERMS_CHANGED' });
  });

  it('never puts a non-uuid booking id in a path', async () => {
    const { api, calls } = clientApi(() => ok(quote));
    expect(await rejection(api.bookings.cancellationQuote('../admin'))).toMatchObject({
      code: 'INVALID_ID',
    });
    expect(calls).toHaveLength(0);
  });
});
