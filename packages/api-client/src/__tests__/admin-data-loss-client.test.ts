import { describe, expect, it } from 'vitest';
import { createAdminApiClient } from '../admin-client.js';
import { memoryTokens, mockFetch, ok, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
const NOTE = 'Both cards corrupted; reader logs attached';
const FOUR_EYES = { code: '123456', coApprover: { email: 'qm-2@clickco.test', code: '654321' } };

function admin(reply: Parameters<typeof mockFetch>[0]) {
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch(reply);
  return { api: createAdminApiClient({ baseUrl: BASE, fetch, tokens }), calls };
}

describe('confirming a lost shoot from the booking page (ADR-0030 D2)', () => {
  it('a complete loss: the note and both codes under the panel’s Idempotency-Key', async () => {
    const answer = {
      bookingId: UUID,
      status: 'DATA_LOSS',
      refundPaise: 425_000,
      refundIds: [UUID_2],
      supersededRefundIds: [],
    };
    const { api, calls } = admin(() => ok(answer));
    await expect(
      api.bookings.confirmDataLoss(UUID, { note: NOTE, ...FOUR_EYES }, { idempotencyKey: KEY }),
    ).resolves.toEqual(answer);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/admin/bookings/${UUID}/data-loss`,
      body: { note: NOTE, ...FOUR_EYES },
      headers: { 'idempotency-key': KEY, authorization: 'Bearer access-1' },
    });
  });

  it('a partial loss: the share in basis points', async () => {
    const answer = {
      bookingId: UUID,
      status: 'QA',
      affectedProportionBps: 3_000,
      owedPaise: 255_000,
      refundPaise: 255_000,
      dueAfterBalancePaise: 0,
      refundIds: [UUID_2],
    };
    const { api, calls } = admin(() => ok(answer));
    const body = { affectedProportionBps: 3_000, note: NOTE, ...FOUR_EYES };
    await expect(
      api.bookings.confirmPartialLoss(UUID, body, { idempotencyKey: KEY }),
    ).resolves.toEqual(answer);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/admin/bookings/${UUID}/partial-loss`,
      body,
    });
  });

  it('never sends a short note, a missing code, a whole-shoot share or a bad booking id', async () => {
    const { api, calls } = admin(() => ok({}));
    const idem = { idempotencyKey: KEY };
    await expect(
      api.bookings.confirmDataLoss(UUID, { note: 'lost', ...FOUR_EYES }, idem),
    ).rejects.toThrow();
    await expect(
      api.bookings.confirmDataLoss(
        UUID,
        { note: NOTE, coApprover: FOUR_EYES.coApprover } as never,
        idem,
      ),
    ).rejects.toThrow();
    await expect(
      api.bookings.confirmPartialLoss(
        UUID,
        { affectedProportionBps: 10_000, note: NOTE, ...FOUR_EYES },
        idem,
      ),
    ).rejects.toThrow();
    await expect(
      api.bookings.confirmDataLoss('../staff', { note: NOTE, ...FOUR_EYES }, idem),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
