import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client.js';
import { isApiError } from '../errors.js';
import { createProApiClient } from '../pro-client.js';
import { memoryTokens, mockFetch, ok, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const prefs = {
  whatsappOptIn: true,
  muteWhatsapp: false,
  muteSms: false,
  mutePush: false,
  updatedAt: '2026-11-14T10:00:00+05:30',
};
const call = {
  bookingId: UUID,
  callId: UUID_2,
  virtualNumber: '08047112233',
  status: 'CONNECTING',
};

const clients = () => {
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch((c) => {
    if (c.url.endsWith('/push-tokens')) {
      return ok({ registered: true, platform: 'ios', lastSeenAt: '2026-11-14T10:00:00+05:30' });
    }
    if (c.url.endsWith('/unregister')) return ok({ unregistered: true });
    if (c.url.endsWith('/notification-preferences')) return ok(prefs);
    return ok(call);
  });
  return {
    calls,
    client: createApiClient({ baseUrl: BASE, fetch, tokens }),
    pro: createProApiClient({ baseUrl: BASE, fetch, tokens }),
  };
};

describe('notifications and masked calls (ADR-0027)', () => {
  it('the client app registers, reads and updates under /me with its session', async () => {
    const { client, calls } = clients();
    await client.notifications.registerPushToken({ token: TOKEN, platform: 'ios' });
    await client.notifications.unregisterPushToken(TOKEN);
    expect(await client.notifications.preferences()).toEqual(prefs);
    await client.notifications.updatePreferences({ muteSms: true });
    expect(calls.map((c) => [c.method, c.url.replace(BASE, ''), c.body])).toEqual([
      ['POST', '/me/push-tokens', { token: TOKEN, platform: 'ios' }],
      ['POST', '/me/push-tokens/unregister', { token: TOKEN }],
      ['GET', '/me/notification-preferences', undefined],
      ['POST', '/me/notification-preferences', { muteSms: true }],
    ]);
    expect(calls.every((c) => c.headers.authorization === 'Bearer access-1')).toBe(true);
  });

  it('the Pro app uses /pro for the same settings', async () => {
    const { pro, calls } = clients();
    await pro.notifications.registerPushToken({ token: TOKEN, platform: 'android' });
    await pro.notifications.preferences();
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual([
      '/pro/push-tokens',
      '/pro/notification-preferences',
    ]);
  });

  it('starts a masked call from either app; ids that are not UUIDs never reach a path', async () => {
    const { client, pro, calls } = clients();
    expect(await client.calls.start(UUID)).toEqual(call);
    await pro.calls.start(UUID_2);
    expect(calls.map((c) => [c.method, c.url.replace(BASE, '')])).toEqual([
      ['POST', `/bookings/${UUID}/call`],
      ['POST', `/pro/assignments/${UUID_2}/call`],
    ]);
    const error = await client.calls.start('../admin').catch((e: unknown) => e);
    expect(isApiError(error) && error.code).toBe('INVALID_ID');
    const proError = await pro.calls.start('..').catch((e: unknown) => e);
    expect(isApiError(proError) && proError.code).toBe('INVALID_ID');
    expect(calls).toHaveLength(2);
  });
});
