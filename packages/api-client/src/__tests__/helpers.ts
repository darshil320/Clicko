import type { BookingSummary, PriceQuote, TokenPair } from '@clickco/contracts';
import { vi } from 'vitest';
import type { FetchLike, TokenStore } from '../http.js';

export const UUID = '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f';
export const UUID_2 = '8e0a4d2b-3c5f-4d9e-8a21-2b3c4d5e6f70';

export interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export interface Reply {
  readonly status: number;
  readonly body: unknown;
  /** Raw text instead of JSON (to simulate a proxy's HTML error page). */
  readonly raw?: string;
  /** A binary answer (a KYC document) and its content type. */
  readonly bytes?: Uint8Array;
  readonly contentType?: string;
}

export const ok = (data: unknown, status = 200): Reply => ({
  status,
  body: { success: true, data, error: null },
});

export const fail = (status: number, code: string, message: string): Reply => ({
  status,
  body: { success: false, data: null, error: { code, message } },
});

/** A fetch mock that answers from a queue (or a router) and records every call. */
export function mockFetch(route: (call: Recorded) => Reply | Promise<Reply>) {
  const calls: Recorded[] = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    const call: Recorded = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    calls.push(call);
    const reply = await route(call);
    return {
      status: reply.status,
      text: async () => reply.raw ?? JSON.stringify(reply.body),
      arrayBuffer: async () => {
        const b = reply.bytes ?? new Uint8Array();
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
      headers: {
        get: (name: string) => (name === 'content-type' ? (reply.contentType ?? null) : null),
      },
    };
  });
  return { fetch, calls };
}

export function memoryTokens(initial: { access: string | null; refresh: string | null }) {
  let access = initial.access;
  let refresh = initial.refresh;
  const store: TokenStore & { cleared: number } = {
    cleared: 0,
    getAccessToken: () => access,
    getRefreshToken: () => refresh,
    setTokens: (pair) => {
      access = pair.accessToken;
      refresh = pair.refreshToken;
    },
    clear: () => {
      access = null;
      refresh = null;
      store.cleared += 1;
    },
  };
  return store;
}

export const tokenPair = (n: number): TokenPair => ({
  accessToken: `access-${n}`,
  accessTokenExpiresAt: '2026-11-14T10:15:00+05:30',
  refreshToken: `refresh-token-${n}-${'x'.repeat(40)}`,
  refreshTokenExpiresAt: '2026-12-14T10:00:00+05:30',
});

export const bookingSummary = (overrides: Partial<BookingSummary> = {}): BookingSummary => ({
  id: UUID,
  reference: 'CLK-4821',
  status: 'QUOTED',
  tier: 'PROFESSIONAL',
  categoryCode: 'FOOD',
  cityName: 'Surat',
  scheduledStart: '2026-11-14T16:30:00+05:30',
  scheduledHours: 2,
  emergencyBand: 'NONE',
  venueAddress: '14, Rajhans Platinum, Vesu, Surat',
  totalPaise: 1153450,
  advancePaise: 576725,
  balancePaise: 576725,
  amountPaidPaise: 0,
  quoteExpiresAt: '2026-11-01T10:15:00+05:30',
  createdAt: '2026-11-01T10:00:00+05:30',
  ...overrides,
});

export const priceQuote = (): PriceQuote => ({
  kind: 'QUOTE',
  currency: 'INR',
  pricesIncludeGst: false,
  tier: 'PROFESSIONAL',
  cityTier: 'TIER_1',
  categoryCode: 'FOOD',
  hours: 2,
  emergencyBand: 'NONE',
  isGuaranteed: true,
  captureOnAcceptOnly: false,
  isPeakSeason: false,
  travelZone: 0,
  airspaceCheckRequired: false,
  lines: [
    {
      code: 'BASE',
      label: 'Professional · Food · 2 hours',
      detail: '₹4,250/hr × 2 hrs',
      amountPaise: 977500,
    },
  ],
  subtotalPaise: 977500,
  discountPaise: 0,
  gst: {
    rateBps: 1800,
    sac: '998383',
    placeOfSupply: '24',
    cgstPaise: 87975,
    sgstPaise: 87975,
    igstPaise: 0,
  },
  totalPaise: 1153450,
  advancePaise: 576725,
  balancePaise: 576725,
  factorsApplied: {
    categoryUpliftBps: 11500,
    emergencyBps: 10000,
    surgeBps: 10000,
    nightBps: 10000,
    weekendBps: 10000,
  },
  rulesetVersion: '2026.10.01',
  computedAt: '2026-11-01T10:00:00+05:30',
  quoteExpiresAt: '2026-11-01T10:15:00+05:30',
});
