import type { VerifyOtpResponse } from '@clickco/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** An in-memory stand-in for the MMKV store (the real one is native). */
const memory = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    trims: { count: 0 },
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    },
  };
});

vi.mock('../storage/kv', () => ({
  kvStorage: memory.storage,
  compactKv: () => {
    memory.trims.count += 1;
  },
  wipeKv: () => {
    memory.data.clear();
    memory.trims.count += 1;
  },
}));

const { eraseDeletedAccount } = await import('./erase');
const { onSessionEnd, sessionEndReset } = await import('./reset');
const { eraseThisDevice, useSession } = await import('./store');

/** Every key the app persists today (zustand `persist` names), plus one no reset knows about. */
const PERSISTED_KEYS = [
  'clickco.session',
  'clickco.booking-draft',
  'clickco.care-keys',
  'clickco.booking-keys',
  'clickco.account-keys',
  'clickco.location',
  'clickco.some-future-store',
] as const;

const SIGNED_IN: VerifyOtpResponse = {
  user: {
    id: 'f3b0c6a2-1d4e-4a8b-9c7d-2e5f6a7b8c9d',
    phone: '+919800000777',
    fullName: 'Priya Sharma',
    isNew: false,
  },
  accessToken: 'access',
  accessTokenExpiresAt: '2026-11-05T10:00:00.000Z',
  refreshToken: 'refresh',
  refreshTokenExpiresAt: '2026-12-05T10:00:00.000Z',
};

/** The root layout's reset, with each feature's clear standing in as a counter. */
function registerAppResets() {
  const cleared: string[] = [];
  const clear = (name: string) => () => cleared.push(name);
  const off = onSessionEnd(
    sessionEndReset({
      bookingDraft: clear('booking draft'),
      keyRings: [clear('care keys'), clear('booking keys'), clear('account keys')],
      queryCache: clear('query cache'),
      shootLocation: clear('shoot location'),
    }),
  );
  return { cleared, off };
}

beforeEach(() => {
  memory.data.clear();
  memory.trims.count = 0;
  for (const key of PERSISTED_KEYS) memory.data.set(key, '{"state":{},"version":1}');
  useSession.getState().signIn(SIGNED_IN);
});

afterEach(() => {
  useSession.setState({ tokens: null, user: null });
});

describe('erasing a deleted account from the phone', () => {
  it('ends the session as a deletion first, then wipes the store', () => {
    const calls: string[] = [];
    eraseDeletedAccount({
      endSession: (reason) => calls.push(`end:${reason}`),
      wipeStorage: () => calls.push('wipe'),
    });
    expect(calls).toEqual(['end:account-deleted', 'wipe']);
  });

  it('leaves nothing: session, draft, every key ring, the query cache, the location, every stored key', () => {
    const app = registerAppResets();
    expect(useSession.getState().tokens).not.toBeNull();

    eraseThisDevice();

    expect(useSession.getState().tokens).toBeNull();
    expect(useSession.getState().user).toBeNull();
    expect(app.cleared).toEqual([
      'booking draft',
      'care keys',
      'booking keys',
      'account keys',
      'query cache',
      'shoot location',
    ]);
    expect([...memory.data.keys()]).toEqual([]);
    expect(memory.trims.count).toBeGreaterThan(0);
    app.off();
  });

  it('a plain sign-out keeps the device choices and the store itself', () => {
    const app = registerAppResets();

    useSession.getState().signOut();

    expect(useSession.getState().tokens).toBeNull();
    expect(app.cleared).toEqual([
      'booking draft',
      'care keys',
      'booking keys',
      'account keys',
      'query cache',
    ]);
    expect(memory.data.has('clickco.location')).toBe(true);
    app.off();
  });
});
