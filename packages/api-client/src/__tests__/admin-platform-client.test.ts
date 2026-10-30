import { describe, expect, it, vi } from 'vitest';
import { createAdminApiClient } from '../admin-client.js';
import { isApiError } from '../errors.js';
import { fail, memoryTokens, mockFetch, ok, tokenPair, UUID, UUID_2 } from './helpers.js';

/** ADR-0026 stream E: Today's overview, the password lifecycle (D7). */

const BASE = 'http://localhost:4000';

function client(reply: Parameters<typeof mockFetch>[0]) {
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch(reply);
  const api = createAdminApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired: vi.fn() });
  return { api, calls, tokens };
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

const overview = {
  generatedAt: '2026-10-30T09:30:00.000Z',
  tiles: [
    {
      key: 'qa.waiting',
      desk: 'qa',
      label: 'Waiting for QA',
      hint: 'Shoots uploaded and waiting for a quality check',
      value: 3,
      capped: false,
      tone: 'attention',
    },
  ],
  needsYou: [
    {
      desk: 'qa',
      count: 3,
      capped: false,
      title: 'Waiting for QA',
      line: '3 shoots are waiting for a quality check.',
      action: 'Start checking',
      tone: 'attention',
    },
  ],
  latestAlerts: [],
  incomplete: false,
};

const staffRow = {
  id: UUID_2,
  email: 'aisha.khan@clickco.in',
  fullName: 'Aisha Khan',
  isActive: true,
  totpEnrolled: true,
  lastLoginAt: null,
  temporaryPasswordExpiresAt: '2026-11-02T09:30:00.000Z',
  grants: [],
};

describe('createAdminApiClient — overview (ADR-0026 D8)', () => {
  it('reads GET /admin/overview with the session', async () => {
    const { api, calls } = client(() => ok(overview));

    const res = await api.overview.get();

    expect(res.needsYou[0]?.desk).toBe('qa');
    expect(calls[0]?.url).toBe(`${BASE}/admin/overview`);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
  });

  it('refuses an answer that names an unknown desk', async () => {
    const { api } = client(() =>
      ok({ ...overview, needsYou: [{ ...overview.needsYou[0], desk: 'x' }] }),
    );

    const error = await rejection(api.overview.get());

    expect(error.code).toBe('INVALID_RESPONSE');
  });
});

describe('createAdminApiClient — passwords (ADR-0026 D7)', () => {
  it('sends the new password with the code when the challenge asks for it', async () => {
    const { api, calls } = client(() =>
      ok({
        ...tokenPair(1),
        staff: { id: UUID, email: 'aisha.khan@clickco.in', fullName: 'Aisha Khan', grants: [] },
      }),
    );

    await api.auth.totp({ challengeId: UUID, code: '123456', newPassword: 'a-long-new-password' });
    const short = await rejection(
      api.auth.totp({ challengeId: UUID, code: '123456', newPassword: 'short' }),
    );

    expect(calls[0]?.body).toEqual({
      challengeId: UUID,
      code: '123456',
      newPassword: 'a-long-new-password',
    });
    expect(short.message).toBe('Use at least 12 characters');
    expect(calls).toHaveLength(1);
  });

  it('changes the password and keeps the new session it answers with', async () => {
    const { api, calls, tokens } = client(() => ok(tokenPair(2)));

    await api.auth.changePassword({
      currentPassword: 'the-old-password',
      newPassword: 'the-new-password-1',
      code: '654321',
    });

    expect(calls[0]?.url).toBe(`${BASE}/admin/me/password`);
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
    expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
    expect(tokens.getAccessToken()).toBe(tokenPair(2).accessToken);
  });

  it('shows the server’s words when the current password is wrong', async () => {
    const { api, tokens } = client(() =>
      fail(422, 'CURRENT_PASSWORD_WRONG', 'Your current password is not right'),
    );

    const error = await rejection(
      api.auth.changePassword({
        currentPassword: 'nope',
        newPassword: 'the-new-password-1',
        code: '654321',
      }),
    );

    expect([error.status, error.message]).toEqual([422, 'Your current password is not right']);
    expect(tokens.getAccessToken()).toBe('access-1');
  });

  it('resets a password on a UUID path without an Idempotency-Key (the answer is a secret)', async () => {
    const { api, calls } = client(() =>
      ok({
        staff: staffRow,
        temporaryPassword: 'tmp-Password-1234567',
        expiresAt: '2026-11-02T09:30:00.000Z',
      }),
    );

    const res = await api.staff.resetPassword(UUID_2);
    const bad = await rejection(api.staff.resetPassword('staff-1'));

    expect(res.temporaryPassword).toBe('tmp-Password-1234567');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/admin/staff/${UUID_2}/reset-password`);
    expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
    expect(bad.code).toBe('INVALID_ID');
  });
});

describe('a session replaced during a refresh (security review L5)', () => {
  it('keeps the new session when the old refresh token is refused', async () => {
    const tokens = memoryTokens({ access: 'old-access', refresh: 'old-refresh' });
    const onSessionExpired = vi.fn();
    let calls = 0;
    const { fetch } = mockFetch((call) => {
      calls += 1;
      if (call.url.endsWith('/admin/auth/refresh')) {
        // A password change landed while the refresh was in flight.
        tokens.setTokens(tokenPair(9));
        return fail(401, 'SESSION_INVALID', 'Please sign in again');
      }
      return call.headers.authorization === `Bearer ${tokenPair(9).accessToken}`
        ? ok({ id: UUID, email: 'aisha.khan@clickco.in', fullName: 'Aisha Khan', grants: [] })
        : fail(401, 'SESSION_INVALID', 'Please sign in again');
    });
    const api = createAdminApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired });

    const me = await api.me();

    expect(me.fullName).toBe('Aisha Khan');
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(calls).toBe(3);
  });
});
