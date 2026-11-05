import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client.js';
import { isApiError } from '../errors.js';
import { fail, memoryTokens, mockFetch, ok, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
const AT = '2026-12-07T10:00:00+05:30';

const preview = {
  canDelete: false,
  blockers: [
    {
      kind: 'BOOKING_IN_PROGRESS',
      bookingId: UUID,
      reference: 'CLK-1004',
      message: 'CLK-1004 is paid and not finished yet.',
    },
  ],
  erases: ['Your name, phone number and email.'],
  keeps: ['Tax invoices, for 8 years.'],
  forfeitedCreditPaise: 50_000,
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

describe('account deletion (ADR-0030)', () => {
  it('reads what deleting does, signed in', async () => {
    const { api, calls } = clientApi(() => ok(preview));
    await expect(api.account.deletion()).resolves.toEqual(preview);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      url: `${BASE}/me/deletion`,
      headers: { authorization: 'Bearer access-1' },
    });
  });

  it('asks for a code, and surfaces the refusal with its blockers', async () => {
    const challenge = { challengeId: UUID_2, expiresAt: AT, resendAfterSeconds: 30 };
    const { api, calls } = clientApi(() => ok(challenge));
    await expect(api.account.requestDeletion()).resolves.toEqual(challenge);
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/me/deletion/request` });

    const refused = clientApi(() =>
      fail(409, 'ACCOUNT_DELETION_BLOCKED', 'CLK-1004 is paid and not finished yet.'),
    );
    const error = await rejection(refused.api.account.requestDeletion());
    expect(error).toMatchObject({ status: 409, code: 'ACCOUNT_DELETION_BLOCKED' });
  });

  it('confirms with the code under the caller’s Idempotency-Key', async () => {
    const { api, calls } = clientApi(() => ok({ deleted: true, deletedAt: AT }));
    const body = { challengeId: UUID_2, code: '123456' };
    await expect(api.account.confirmDeletion(body, { idempotencyKey: KEY })).resolves.toEqual({
      deleted: true,
      deletedAt: AT,
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/me/deletion/confirm`,
      body,
      headers: { 'idempotency-key': KEY, authorization: 'Bearer access-1' },
    });
  });

  it('refuses a malformed code before sending anything', async () => {
    const { api, calls } = clientApi(() => ok({}));
    await expect(
      api.account.confirmDeletion({ challengeId: UUID_2, code: '12ab' }, { idempotencyKey: KEY }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
