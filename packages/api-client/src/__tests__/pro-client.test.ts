import { describe, expect, it } from 'vitest';
import { isApiError } from '../errors.js';
import { createProApiClient, PRO_REFRESH_PATH } from '../pro-client.js';
import { fail, memoryTokens, mockFetch, ok, tokenPair, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b';

const proOffer = {
  attemptId: UUID,
  bookingId: UUID_2,
  bookingReference: 'CLK-4821',
  categoryCode: 'FOOD',
  tier: 'PROFESSIONAL',
  scheduledStart: '2026-11-14T16:30:00+05:30',
  scheduledHours: 2,
  emergencyBand: 'NONE',
  isBroadcast: false,
  payoutPaise: 510000,
  distanceKm: 3.5,
  area: { pincode: '395007', areaName: 'Vesu', cityName: 'Surat' },
  clientDisplayName: 'Priya S.',
  expiresAt: '2026-11-14T10:02:00+05:30',
};

const checkInResponse = {
  assignmentId: UUID,
  bookingId: UUID_2,
  bookingStatus: 'CHECKED_IN',
  checkedInAt: '2026-11-14T16:20:00+05:30',
  distanceM: 42.5,
  accuracyM: 12,
  geofenceBasis: 'VENUE',
  geofenceVerified: true,
  offline: false,
  billingStartsAt: '2026-11-14T16:30:00+05:30',
  replayed: false,
};

describe('createProApiClient', () => {
  it('lists offers with the photographer token', async () => {
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch(() => ok([proOffer]));
    const api = createProApiClient({ baseUrl: BASE, fetch, tokens });

    const offers = await api.offers.list();

    expect(offers[0]?.payoutPaise).toBe(510000);
    expect(calls[0]?.url).toBe(`${BASE}/pro/offers`);
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
  });

  it('refreshes a photographer session at /pro/auth/refresh, never the client route', async () => {
    const tokens = memoryTokens({ access: 'stale', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch((call) => {
      if (call.url.endsWith(PRO_REFRESH_PATH)) return ok(tokenPair(2));
      return call.headers.authorization === 'Bearer access-2'
        ? ok([])
        : fail(401, 'UNAUTHORIZED', 'Token expired');
    });
    const api = createProApiClient({ baseUrl: BASE, fetch, tokens });

    await api.assignments.list();

    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual([
      '/pro/assignments',
      '/pro/auth/refresh',
      '/pro/assignments',
    ]);
    expect(tokens.getAccessToken()).toBe('access-2');
  });

  it('checks in with the fix, deviceTs and the Idempotency-Key', async () => {
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch(() => ok(checkInResponse));
    const api = createProApiClient({ baseUrl: BASE, fetch, tokens });
    const body = {
      lat: 21.1702,
      lng: 72.8311,
      accuracyM: 12,
      deviceTs: '2026-11-14T16:20:00+05:30',
      offline: true,
      mocked: false,
    };

    const res = await api.onsite.checkIn(UUID, body, { idempotencyKey: KEY });

    expect(res.geofenceVerified).toBe(true);
    expect(calls[0]?.url).toBe(`${BASE}/pro/assignments/${UUID}/check-in`);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual(body);
    expect(calls[0]?.headers['idempotency-key']).toBe(KEY);
  });

  it('asks for a one-hour extension with the device time', async () => {
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch(() =>
      ok({
        eventId: '42',
        assignmentId: UUID,
        bookingId: UUID_2,
        hours: 1,
        hourlyRatePaise: 425000,
        charge: {
          taxablePaise: 425000,
          gstPaise: 76500,
          cgstPaise: 38250,
          sgstPaise: 38250,
          igstPaise: 0,
          totalPaise: 501500,
        },
        status: 'PENDING',
        requestedAt: '2026-11-14T18:00:00+05:30',
        expiresAt: '2026-11-14T18:10:00+05:30',
      }),
    );
    const api = createProApiClient({ baseUrl: BASE, fetch, tokens });

    const ext = await api.onsite.requestExtension(UUID, '2026-11-14T18:00:00+05:30', {
      idempotencyKey: KEY,
    });

    expect(ext.status).toBe('PENDING');
    expect(calls[0]?.url).toBe(`${BASE}/pro/assignments/${UUID}/extensions`);
    expect(calls[0]?.body).toEqual({ hours: 1, deviceTs: '2026-11-14T18:00:00+05:30' });
  });

  it('refuses an id that is not a UUID before building a path', async () => {
    const { fetch, calls } = mockFetch(() => ok({}));
    const api = createProApiClient({
      baseUrl: BASE,
      fetch,
      tokens: memoryTokens({ access: 'a', refresh: 'r' }),
    });

    const error = await api.assignments.get('../../admin').catch((e: unknown) => e);

    expect(isApiError(error) && error.code).toBe('INVALID_ID');
    expect(calls).toHaveLength(0);
  });

  it('reports no network as NETWORK, which is what sends an on-site action to the offline queue', async () => {
    const fetch = async () => {
      throw new TypeError('Network request failed');
    };
    const api = createProApiClient({
      baseUrl: BASE,
      fetch,
      tokens: memoryTokens({ access: 'a', refresh: 'r' }),
    });

    const error = await api.onsite.start(UUID, { idempotencyKey: KEY }).catch((e: unknown) => e);

    expect(isApiError(error) && error.kind).toBe('NETWORK');
  });
});
