import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client.js';
import { ApiError, isApiError } from '../errors.js';
import {
  bookingSummary,
  fail,
  memoryTokens,
  mockFetch,
  ok,
  priceQuote,
  tokenPair,
  UUID,
  UUID_2,
} from './helpers.js';

const BASE = 'http://localhost:4000';

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('envelope handling', () => {
  it('unwraps a success envelope and validates it against the contract', async () => {
    const { fetch, calls } = mockFetch(() =>
      ok({ challengeId: UUID, expiresAt: '2026-11-14T10:05:00+05:30', resendAfterSeconds: 30 }),
    );
    const api = createApiClient({ baseUrl: `${BASE}/`, fetch });

    const result = await api.auth.requestOtp({ phone: '+919800000777', purpose: 'LOGIN' });

    expect(result.challengeId).toBe(UUID);
    expect(calls[0]?.url).toBe(`${BASE}/auth/otp/request`);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers['content-type']).toBe('application/json');
    expect(calls[0]?.body).toEqual({ phone: '+919800000777', purpose: 'LOGIN' });
  });

  it('turns an error envelope into a typed ApiError', async () => {
    const { fetch } = mockFetch(() =>
      fail(429, 'OTP_COOLDOWN', 'Wait 30 seconds before asking again'),
    );
    const api = createApiClient({ baseUrl: BASE, fetch });

    const error = await caught(api.auth.requestOtp({ phone: '+919800000777', purpose: 'LOGIN' }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('HTTP');
    expect(error.status).toBe(429);
    expect(error.code).toBe('OTP_COOLDOWN');
    expect(error.message).toBe('Wait 30 seconds before asking again');
    expect(error.isClientError).toBe(true);
  });

  it('reports a non-JSON body (a proxy error page) as INVALID_RESPONSE', async () => {
    const { fetch } = mockFetch(() => ({
      status: 502,
      body: null,
      raw: '<html>Bad gateway</html>',
    }));
    const api = createApiClient({ baseUrl: BASE, fetch });

    const error = await caught(api.serviceability.check('395007'));

    expect(error.kind).toBe('INVALID_RESPONSE');
    expect(error.status).toBe(502);
  });

  it('rejects data that breaks the contract instead of passing it through', async () => {
    const { fetch } = mockFetch(() => ok({ bookable: true, pincode: 'not-a-pincode' }));
    const api = createApiClient({ baseUrl: BASE, fetch });

    const error = await caught(api.serviceability.check('395007'));

    expect(error.kind).toBe('INVALID_RESPONSE');
    expect(error.code).toBe('INVALID_RESPONSE');
  });

  it('reports a network failure as NETWORK with status 0', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const api = createApiClient({ baseUrl: BASE, fetch });

    const error = await caught(api.serviceability.check('395007'));

    expect(error.kind).toBe('NETWORK');
    expect(error.status).toBe(0);
    expect(error.message).toContain('Failed to fetch');
  });

  it('times out a request that never answers', async () => {
    const fetch = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const api = createApiClient({ baseUrl: BASE, fetch, timeoutMs: 10 });

    const error = await caught(api.serviceability.check('395007'));

    expect(error.kind).toBe('NETWORK');
    expect(error.code).toBe('TIMEOUT');
  });

  it('encodes path segments', async () => {
    const { fetch, calls } = mockFetch(() => ok({ phone: '+919800000777', code: '123456' }));
    const api = createApiClient({ baseUrl: BASE, fetch });

    await api.dev.latestOtp('+919800000777');

    expect(calls[0]?.url).toBe(`${BASE}/dev/otp/%2B919800000777`);
  });
});

describe('authentication', () => {
  it('sends the bearer token on authenticated calls only', async () => {
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch((call) =>
      call.url.endsWith('/bookings') ? ok([bookingSummary()]) : ok(priceQuote()),
    );
    const api = createApiClient({ baseUrl: BASE, fetch, tokens });

    await api.bookings.list();
    await api.pricing.quote({
      tier: 'PROFESSIONAL',
      categoryCode: 'FOOD',
      pincode: '395007',
      scheduledStart: '2026-11-14T16:30:00+05:30',
      hours: 2,
    });

    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
    expect(calls[1]?.headers.authorization).toBeUndefined();
  });

  it('refreshes once on a 401 and retries with the new access token', async () => {
    const tokens = memoryTokens({ access: 'stale', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith('/auth/refresh')) return ok(tokenPair(2));
      return call.headers.authorization === 'Bearer access-2'
        ? ok({ id: UUID, phone: '+919800000777', fullName: 'Priya Sharma' })
        : fail(401, 'UNAUTHORIZED', 'Token expired');
    });
    const api = createApiClient({ baseUrl: BASE, fetch, tokens });

    const me = await api.me();

    expect(me.fullName).toBe('Priya Sharma');
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual(['/me', '/auth/refresh', '/me']);
    expect(calls[1]?.body).toEqual({ refreshToken: 'refresh-1' });
    expect(calls[1]?.headers.authorization).toBeUndefined();
    expect(tokens.getAccessToken()).toBe('access-2');
    expect(tokens.getRefreshToken()).toBe(tokenPair(2).refreshToken);
  });

  it('shares a single refresh between concurrent 401s', async () => {
    const tokens = memoryTokens({ access: 'stale', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch(async (call) => {
      if (call.url.endsWith('/auth/refresh')) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return ok(tokenPair(2));
      }
      return call.headers.authorization === 'Bearer access-2'
        ? ok([bookingSummary()])
        : fail(401, 'UNAUTHORIZED', 'Token expired');
    });
    const api = createApiClient({ baseUrl: BASE, fetch, tokens });

    await Promise.all([api.bookings.list(), api.bookings.list(), api.bookings.list()]);

    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('ends the session when the refresh token is rejected', async () => {
    const tokens = memoryTokens({ access: 'stale', refresh: 'revoked' });
    const onSessionExpired = vi.fn();
    const { fetch } = mockFetch((call) =>
      call.url.endsWith('/auth/refresh')
        ? fail(401, 'UNAUTHORIZED', 'Refresh token revoked')
        : fail(401, 'UNAUTHORIZED', 'Token expired'),
    );
    const api = createApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired });

    const error = await caught(api.bookings.list());

    expect(error.status).toBe(401);
    expect(tokens.cleared).toBe(1);
    expect(tokens.getRefreshToken()).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the refresh fails only because the network dropped', async () => {
    const tokens = memoryTokens({ access: 'stale', refresh: 'refresh-1' });
    const onSessionExpired = vi.fn();
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('Network request failed');
      return {
        status: 401,
        text: async () => JSON.stringify(fail(401, 'UNAUTHORIZED', 'Token expired').body),
      };
    });
    const api = createApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired });

    const error = await caught(api.bookings.list());

    expect(error.kind).toBe('NETWORK');
    expect(tokens.cleared).toBe(0);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('keeps the session when the refresh is only rate-limited (shared CGNAT IPs)', async () => {
    const tokens = memoryTokens({ access: 'stale', refresh: 'refresh-1' });
    const onSessionExpired = vi.fn();
    const { fetch } = mockFetch((call) =>
      call.url.endsWith('/auth/refresh')
        ? fail(429, 'RATE_LIMITED', 'Too many requests')
        : fail(401, 'UNAUTHORIZED', 'Token expired'),
    );
    const api = createApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired });

    const error = await caught(api.bookings.list());

    expect(error.status).toBe(429);
    expect(tokens.cleared).toBe(0);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('does not try to refresh when there is no refresh token', async () => {
    const tokens = memoryTokens({ access: null, refresh: null });
    const onSessionExpired = vi.fn();
    const { fetch, calls } = mockFetch(() => fail(401, 'UNAUTHORIZED', 'Sign in first'));
    const api = createApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired });

    await caught(api.bookings.list());

    expect(calls).toHaveLength(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

describe('money-mutating calls', () => {
  it('sends the Idempotency-Key and reuses it on the post-refresh retry', async () => {
    const tokens = memoryTokens({ access: 'stale', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith('/auth/refresh')) return ok(tokenPair(2));
      if (call.headers.authorization !== 'Bearer access-2') {
        return fail(401, 'UNAUTHORIZED', 'Token expired');
      }
      return ok({
        paymentId: UUID_2,
        gateway: 'SANDBOX',
        providerOrderId: 'sandbox_order_1',
        amountPaise: 576725,
        authorizeOnly: false,
        checkoutKeyId: null,
      });
    });
    const api = createApiClient({ baseUrl: BASE, fetch, tokens });

    const payment = await api.bookings.pay(UUID, { idempotencyKey: 'pay-key-0001' });

    expect(payment.gateway).toBe('SANDBOX');
    const payCalls = calls.filter((c) => c.url.endsWith(`/bookings/${UUID}/pay`));
    expect(payCalls).toHaveLength(2);
    expect(payCalls.map((c) => c.headers['idempotency-key'])).toEqual([
      'pay-key-0001',
      'pay-key-0001',
    ]);
  });

  it('creates a booking with the key and returns booking + quote', async () => {
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch(() =>
      ok({ booking: bookingSummary(), quote: priceQuote() }, 201),
    );
    const api = createApiClient({ baseUrl: BASE, fetch, tokens });

    const created = await api.bookings.create(
      {
        tier: 'PROFESSIONAL',
        categoryCode: 'FOOD',
        pincode: '395007',
        scheduledStart: '2026-11-14T16:30:00+05:30',
        hours: 2,
        venueAddress: '14, Rajhans Platinum, Vesu, Surat',
        booker: { name: 'Priya Sharma', phone: '+919800000777' },
        modelReleaseConsent: false,
        acceptedTermsVersion: 'v2-draft',
      },
      { idempotencyKey: 'create-key-0001' },
    );

    expect(created.booking.reference).toBe('CLK-4821');
    expect(calls[0]?.headers['idempotency-key']).toBe('create-key-0001');
  });

  it('refuses a malformed Idempotency-Key before calling the API', async () => {
    const { fetch, calls } = mockFetch(() => ok(bookingSummary()));
    const api = createApiClient({ baseUrl: BASE, fetch });

    const error = await caught(api.bookings.cancel(UUID, { idempotencyKey: 'short' }));

    expect(error.code).toBe('IDEMPOTENCY_KEY_INVALID');
    expect(calls).toHaveLength(0);
  });

  it('refuses a booking id that is not a UUID before building a path', async () => {
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch(() => ok(bookingSummary()));
    const api = createApiClient({ baseUrl: BASE, fetch, tokens });

    const error = await caught(api.bookings.get('..'));

    expect(error.code).toBe('INVALID_ID');
    expect(calls).toHaveLength(0);
  });

  it('simulates a sandbox payment (development only)', async () => {
    const { fetch, calls } = mockFetch(() =>
      ok({ paymentId: UUID_2, event: 'payment.captured', eventId: 'evt_1', outcome: 'APPLIED' }),
    );
    const api = createApiClient({ baseUrl: BASE, fetch });

    const result = await api.dev.simulatePayment(UUID_2, 'CAPTURED');

    expect(result.event).toBe('payment.captured');
    expect(calls[0]?.body).toEqual({ outcome: 'CAPTURED' });
  });
});
