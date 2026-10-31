import { describe, expect, it, vi } from 'vitest';
import { ADMIN_REFRESH_PATH, adminBookingSearch, createAdminApiClient } from '../admin-client.js';
import { isApiError } from '../errors.js';
import { fail, memoryTokens, mockFetch, ok, tokenPair, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
const UUID_3 = '9f1b5e3c-4d6a-4eaf-9b32-3c4d5e6f7081';
const CITY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const profile = {
  id: UUID,
  email: 'priya.sharma@clickco.in',
  fullName: 'Priya Sharma',
  grants: [{ id: UUID_3, role: 'OPS_AGENT', cityId: CITY, cityName: 'Surat' }],
};

const bookingRow = {
  id: UUID,
  reference: 'CLK-4821',
  status: 'DISPATCHING',
  cityId: CITY,
  cityName: 'Surat',
  categoryCode: 'FOOD',
  tier: 'PROFESSIONAL',
  emergencyBand: 'NONE',
  scheduledStart: '2026-11-14T16:30:00+05:30',
  scheduledHours: 2,
  clientName: 'Rahul Mehta',
  photographerName: null,
  totalPaise: 1153450,
  amountPaidPaise: 576725,
  nextDueAt: null,
  flags: ['NEEDS_REVIEW'],
};

const staffRow = (grants: unknown[]) => ({
  id: UUID_2,
  email: 'aisha.khan@clickco.in',
  fullName: 'Aisha Khan',
  isActive: true,
  totpEnrolled: false,
  lastLoginAt: null,
  temporaryPasswordExpiresAt: null,
  grants,
});

function client(reply: Parameters<typeof mockFetch>[0], access: string | null = 'access-1') {
  const tokens = memoryTokens({ access, refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch(reply);
  const onSessionExpired = vi.fn();
  const api = createAdminApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired });
  return { api, calls, tokens, onSessionExpired };
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

describe('createAdminApiClient — sign-in (ADR-0025 D2)', () => {
  it('posts email + password and returns an enrolment challenge', async () => {
    const challenge = {
      challengeId: UUID,
      step: 'ENROL_TOTP',
      enrolment: {
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/Clickco:priya.sharma%40clickco.in?secret=JBSWY3DPEHPK3PXP',
      },
      mustChangePassword: false,
      expiresAt: '2026-11-14T10:05:00+05:30',
    };
    const { api, calls } = client(() => ok(challenge), null);

    const res = await api.auth.login({ email: ' Priya.Sharma@Clickco.in ', password: 'pw' });

    expect(res.step).toBe('ENROL_TOTP');
    expect(calls[0]?.url).toBe(`${BASE}/admin/auth/login`);
    expect(calls[0]?.body).toEqual({ email: 'priya.sharma@clickco.in', password: 'pw' });
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it('refuses a malformed email or code before any request', async () => {
    const { api, calls } = client(() => ok({}));

    const bad = await rejection(api.auth.login({ email: 'not-an-email', password: 'pw' }));
    const code = await rejection(api.auth.totp({ challengeId: UUID, code: '12345' }));

    expect(bad.code).toBe('INVALID_INPUT');
    expect(code.message).toBe('must be 6 digits');
    expect(calls).toHaveLength(0);
  });

  it('exchanges the TOTP code for the staff session', async () => {
    const { api, calls } = client(() => ok({ ...tokenPair(1), staff: profile }), null);

    const session = await api.auth.totp({ challengeId: UUID, code: '123456' });

    expect(session.staff.grants[0]?.role).toBe('OPS_AGENT');
    expect(calls[0]?.url).toBe(`${BASE}/admin/auth/totp`);
  });

  it('passes the same 401 through for a wrong password', async () => {
    const { api } = client(() => fail(401, 'INVALID_CREDENTIALS', 'Email or password is wrong'));

    const error = await rejection(api.auth.login({ email: 'a@clickco.in', password: 'x' }));

    expect(error.status).toBe(401);
    expect(error.message).toBe('Email or password is wrong');
  });

  it('revokes the refresh token on sign-out', async () => {
    const { api, calls } = client(() => ok({ loggedOut: true }));

    await api.auth.logout('refresh-1');

    expect(calls[0]?.url).toBe(`${BASE}/admin/auth/logout`);
    expect(calls[0]?.body).toEqual({ refreshToken: 'refresh-1' });
  });
});

describe('createAdminApiClient — session', () => {
  it('refreshes a staff session at /admin/auth/refresh only', async () => {
    const { api, calls, tokens } = client((call) => {
      if (call.url.endsWith(ADMIN_REFRESH_PATH)) return ok(tokenPair(2));
      return call.headers.authorization === 'Bearer access-2'
        ? ok(profile)
        : fail(401, 'UNAUTHORIZED', 'Token expired');
    }, 'stale');

    const me = await api.me();

    expect(me.fullName).toBe('Priya Sharma');
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual([
      '/admin/me',
      '/admin/auth/refresh',
      '/admin/me',
    ]);
    expect(tokens.getAccessToken()).toBe('access-2');
  });

  it('ends the session when the refresh token is refused', async () => {
    const { api, tokens, onSessionExpired } = client((call) =>
      call.url.endsWith(ADMIN_REFRESH_PATH)
        ? fail(401, 'UNAUTHORIZED', 'Refresh token revoked')
        : fail(401, 'UNAUTHORIZED', 'Token expired'),
    );

    const error = await rejection(api.me());

    expect(error.status).toBe(401);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(tokens.cleared).toBe(1);
  });

  it('surfaces a 403 with the server’s message', async () => {
    const { api } = client(() => fail(403, 'FORBIDDEN', 'Staff management needs SUPER_ADMIN'));

    const error = await rejection(api.staff.list());

    expect(error.status).toBe(403);
    expect(error.message).toBe('Staff management needs SUPER_ADMIN');
  });
});

describe('createAdminApiClient — booking board', () => {
  it('builds the board query: repeated statuses, attention flag only when on', () => {
    const qs = adminBookingSearch({
      status: ['DISPATCHING', 'ASSIGNED'],
      cityId: CITY,
      from: '2026-11-01',
      to: '2026-11-30',
      q: ' CLK-48 ',
      needsAttention: true,
      cursor: 'abc',
    });
    const params = new URLSearchParams(qs);

    expect(params.getAll('status')).toEqual(['DISPATCHING', 'ASSIGNED']);
    expect(params.get('cityId')).toBe(CITY);
    expect(params.get('q')).toBe('CLK-48');
    expect(params.get('needsAttention')).toBe('true');
    expect(params.get('limit')).toBe('50');
    expect(adminBookingSearch({ needsAttention: false })).toBe('limit=50');
  });

  it('lists bookings as a keyset page', async () => {
    const { api, calls } = client(() => ok({ items: [bookingRow], nextCursor: 'next-1' }));

    const page = await api.bookings.list({ status: ['DISPATCHING'] });

    expect(page.items[0]?.reference).toBe('CLK-4821');
    expect(page.nextCursor).toBe('next-1');
    expect(calls[0]?.url).toBe(`${BASE}/admin/bookings?status=DISPATCHING&limit=50`);
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
  });

  it('refuses a bad filter before the request', async () => {
    const { api, calls } = client(() => ok({ items: [], nextCursor: null }));

    const error = await rejection(api.bookings.list({ cityId: 'surat' }));

    expect(error.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('reads one booking with its audit trail', async () => {
    const detail = {
      ...bookingRow,
      venue: { address: '14, Rajhans Platinum, Vesu, Surat', landmark: null, pincode: '395007' },
      client: { name: 'Rahul Mehta', phone: '+919876543210' },
      advancePaise: 576725,
      balancePaise: 576725,
      timeline: [
        {
          fromStatus: 'CONFIRMED',
          toStatus: 'DISPATCHING',
          actorKind: 'SYSTEM',
          reason: null,
          occurredAt: '2026-11-14T10:00:00+05:30',
        },
      ],
      payments: [],
      assignment: null,
      qaStatus: null,
      slaClocks: [],
      breaches: [],
      alerts: [],
      audit: [
        {
          id: '7',
          action: 'qa.decide',
          actorKind: 'STAFF',
          actorEmail: 'priya.sharma@clickco.in',
          entityKind: 'booking',
          entityId: UUID,
          before: null,
          after: { qaStatus: 'PASSED' },
          occurredAt: '2026-11-14T11:00:00+05:30',
        },
      ],
    };
    const { api, calls } = client(() => ok(detail));

    const booking = await api.bookings.get(UUID);

    expect(booking.audit?.[0]?.action).toBe('qa.decide');
    expect(booking.timeline[0]?.toStatus).toBe('DISPATCHING');
    expect(calls[0]?.url).toBe(`${BASE}/admin/bookings/${UUID}`);
  });

  it('never puts a non-UUID in a path', async () => {
    const { api, calls } = client(() => ok({}));

    const error = await rejection(api.bookings.get('../staff'));

    expect(error.code).toBe('INVALID_ID');
    expect(calls).toHaveLength(0);
  });

  it('rejects a list answer that is not a page (the contract is { items, nextCursor })', async () => {
    const { api } = client(() => ok([bookingRow]));

    const error = await rejection(api.bookings.list());

    expect(error.kind).toBe('INVALID_RESPONSE');
  });
});

/** POST answers, pinned in the contracts (ADR-0025 D5). */
const deliveryView = {
  bookingId: UUID,
  bookingStatus: 'DELIVERED',
  qaStatus: 'PASSED',
  balanceDuePaise: 0,
  counts: null,
  releasedAt: '2026-11-15T10:00:00+05:30',
  rawExpiresAt: null,
  jpegExpiresAt: null,
  links: [],
};
const incidentConfirmed = { assignmentId: UUID, bookingId: UUID_2, bookingStatus: 'UNSAFE_SITE' };
const breachItem = {
  id: UUID,
  bookingId: UUID_2,
  reference: 'CLK-4821',
  cityName: 'Surat',
  photographerName: 'Hetal Patel',
  kind: 'DELIVERY_DUE',
  delayMinutes: 95,
  band: 'H0_6',
  remedyKind: 'CREDIT',
  remedyPaise: 50000,
  payoutDeductionBps: 1000,
  attributedTo: 'CLIENT',
  applied: false,
  waived: false,
  waiveReason: null,
  createdAt: '2026-11-16T10:00:00+05:30',
};

describe('createAdminApiClient — desks', () => {
  it('decides QA with an Idempotency-Key; a FAIL needs a note', async () => {
    const { api, calls } = client(() => ok(deliveryView));

    const noNote = await rejection(
      api.qa.decide(UUID, { result: 'FAIL' }, { idempotencyKey: KEY }),
    );
    await api.qa.decide(UUID, { result: 'PASS' }, { idempotencyKey: KEY });

    expect(noNote.message).toBe('Say why it failed');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/admin/qa/${UUID}`);
    expect(calls[0]?.body).toEqual({ result: 'PASS' });
    expect(calls[0]?.headers['idempotency-key']).toBe(KEY);
  });

  it('pages the QA queue with the cursor', async () => {
    const { api, calls } = client(() => ok({ items: [], nextCursor: null }));

    await api.qa.list({ cursor: 'page-2' });
    const tooLong = await rejection(api.qa.list({ cursor: 'x'.repeat(513) }));

    expect(calls[0]?.url).toBe(`${BASE}/admin/qa?cursor=page-2&limit=50`);
    expect(tooLong.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(1);
  });

  it('confirms an incident with a note', async () => {
    const { api, calls } = client(() => ok(incidentConfirmed));

    await api.incidents.confirm(
      UUID,
      { kind: 'UNSAFE_SITE', note: 'Spoke to Vikram Reddy on call' },
      { idempotencyKey: KEY },
    );
    const short = await rejection(
      api.incidents.confirm(UUID, { kind: 'ACCESS_DENIED', note: 'ok' }, { idempotencyKey: KEY }),
    );

    expect(calls[0]?.url).toBe(`${BASE}/admin/assignments/${UUID}/confirm-incident`);
    expect(calls[0]?.headers['idempotency-key']).toBe(KEY);
    expect(short.code).toBe('INVALID_INPUT');
  });

  it('reads the dispatch desk for one booking', async () => {
    const { api, calls } = client(() =>
      ok({ bookingId: UUID, bookingStatus: 'DISPATCHING', rounds: [], assignments: [] }),
    );

    const desk = await api.dispatch.get(UUID);

    expect(desk.bookingStatus).toBe('DISPATCHING');
    expect(calls[0]?.url).toBe(`${BASE}/admin/dispatch/${UUID}`);
  });

  it('filters breaches and attributes or waives one', async () => {
    const { api, calls } = client((call) =>
      call.method === 'GET' ? ok({ items: [], nextCursor: null }) : ok(breachItem),
    );

    await api.breaches.list({ status: 'WAIVED' });
    await api.breaches.list();
    await api.breaches.attribute(
      UUID,
      { attributedTo: 'CLIENT', note: 'Client asked for a later delivery' },
      { idempotencyKey: KEY },
    );
    await api.breaches.waive(UUID, { reason: 'Goodwill — wedding day' }, { idempotencyKey: KEY });
    const bad = await rejection(api.breaches.list({ status: 'closed' as never }));

    expect(calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`)).toEqual([
      'GET /admin/breaches?limit=50&status=WAIVED',
      'GET /admin/breaches?limit=50&status=OPEN',
      `POST /admin/breaches/${UUID}/attribute`,
      `POST /admin/breaches/${UUID}/waive`,
    ]);
    expect(bad.code).toBe('INVALID_INPUT');
  });

  it('reads the alert feed', async () => {
    const { api, calls } = client(() =>
      ok({
        items: [
          {
            eventId: '42',
            type: 'ops.alert',
            reason: 'DISPATCH_EXHAUSTED',
            bookingId: UUID,
            bookingReference: 'CLK-4821',
            summary: 'No photographer accepted',
            occurredAt: '2026-11-14T10:00:00+05:30',
          },
        ],
        nextCursor: null,
      }),
    );

    const page = await api.alerts.list();

    expect(page.items[0]?.type).toBe('ops.alert');
    expect(calls[0]?.url).toBe(`${BASE}/admin/alerts?limit=50`);
  });
});

describe('createAdminApiClient — staff (SUPER_ADMIN)', () => {
  it('creates staff and returns the temporary password once', async () => {
    const { api, calls } = client(() =>
      ok({ staff: staffRow([]), temporaryPassword: 'tmp-Password-1234567' }),
    );

    const res = await api.staff.create(
      {
        code: '123456',
        email: 'aisha.khan@clickco.in',
        fullName: 'Aisha Khan',
        grants: [{ role: 'SUPPORT', cityId: null }],
      },
      { idempotencyKey: KEY },
    );

    expect(res.temporaryPassword).toBe('tmp-Password-1234567');
    expect(calls[0]?.url).toBe(`${BASE}/admin/staff`);
    expect(calls[0]?.headers['idempotency-key']).toBe(KEY);
    expect(calls[0]?.body).toMatchObject({ code: '123456' });
  });

  it('refuses staff management without a 6-digit authenticator code, before any call (M3)', async () => {
    const { api, calls } = client(() => ok(staffRow([])));
    const idem = { idempotencyKey: KEY };

    const errors = await Promise.all([
      rejection(
        api.staff.create(
          {
            code: '12345',
            email: 'aisha.khan@clickco.in',
            fullName: 'Aisha Khan',
            grants: [{ role: 'SUPPORT', cityId: null }],
          },
          idem,
        ),
      ),
      rejection(api.staff.grant(UUID_2, { code: '', role: 'SUPPORT', cityId: null }, idem)),
      rejection(api.staff.deactivate(UUID_2, 'abcdef', idem)),
      rejection(api.staff.resetTotp(UUID_2, '1234567', idem)),
      rejection(api.staff.resetPassword(UUID_2, '')),
    ]);

    expect(errors.map((e) => e.message)).toEqual(
      Array(5).fill('Enter the 6-digit code from your authenticator app'),
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses a city manager grant without a city', async () => {
    const { api, calls } = client(() => ok(staffRow([])));

    const error = await rejection(
      api.staff.grant(
        UUID_2,
        { code: '123456', role: 'CITY_MANAGER', cityId: null },
        { idempotencyKey: KEY },
      ),
    );
    await api.staff.grant(
      UUID_2,
      { code: '123456', role: 'CITY_MANAGER', cityId: CITY },
      { idempotencyKey: KEY },
    );

    expect(error.message).toBe('A city manager needs a city');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ code: '123456', role: 'CITY_MANAGER', cityId: CITY });
  });

  it('revokes a grant, deactivates and resets TOTP on UUID paths', async () => {
    const { api, calls } = client(() => ok(staffRow([])));

    await api.staff.revokeGrant(UUID_2, UUID_3, { idempotencyKey: KEY });
    await api.staff.deactivate(UUID_2, '123456', { idempotencyKey: KEY });
    await api.staff.resetTotp(UUID_2, '654321', { idempotencyKey: KEY });
    const bad = await rejection(api.staff.revokeGrant(UUID_2, 'grant-1', { idempotencyKey: KEY }));

    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual([
      `/admin/staff/${UUID_2}/grants/${UUID_3}/revoke`,
      `/admin/staff/${UUID_2}/deactivate`,
      `/admin/staff/${UUID_2}/reset-totp`,
    ]);
    expect(calls.every((c) => c.headers['idempotency-key'] === KEY)).toBe(true);
    expect(calls.map((c) => c.body)).toEqual([undefined, { code: '123456' }, { code: '654321' }]);
    expect(bad.code).toBe('INVALID_ID');
  });

  it('lists staff with grant ids, which the revoke route takes', async () => {
    const { api, calls } = client(() =>
      ok({
        items: [
          staffRow([
            { id: UUID_3, role: 'CITY_MANAGER', cityId: CITY, cityName: 'Surat' },
            { id: UUID, role: 'SUPPORT', cityId: null, cityName: null },
          ]),
        ],
        nextCursor: null,
      }),
    );

    const page = await api.staff.list({ limit: 100 });

    expect(page.items[0]?.grants.map((g) => g.id)).toEqual([UUID_3, UUID]);
    expect(calls[0]?.url).toBe(`${BASE}/admin/staff?limit=100`);
  });
});

describe('createAdminApiClient — cities', () => {
  it('lists the cities the caller may work in', async () => {
    const { api, calls } = client(() =>
      ok([{ id: CITY, name: 'Surat', state: 'Gujarat', status: 'LIVE' }]),
    );

    const cities = await api.cities();

    expect(cities[0]?.name).toBe('Surat');
    expect(calls[0]?.url).toBe(`${BASE}/admin/cities`);
    expect(calls[0]?.method).toBe('GET');
  });
});
