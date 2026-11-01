import { describe, expect, it, vi } from 'vitest';
import { createAdminApiClient } from '../admin-client.js';
import { createApiClient } from '../client.js';
import { isApiError } from '../errors.js';
import { createProApiClient } from '../pro-client.js';
import { fail, memoryTokens, mockFetch, ok, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
const AT = '2026-12-07T10:00:00+05:30';

const review = {
  id: UUID,
  bookingId: UUID_2,
  rating: 5,
  comment: 'Lovely candid shots',
  isPublished: true,
  createdAt: AT,
  updatedAt: AT,
  editableUntil: '2026-12-14T10:00:00+05:30',
  canEdit: true,
};

const receipt = { id: UUID, status: 'OPEN', createdAt: AT };

const report = {
  id: UUID,
  targetKind: 'REVIEW',
  targetId: UUID_2,
  targetName: 'Asha Patel',
  reason: 'ABUSIVE',
  note: null,
  reporterKind: 'PHOTOGRAPHER',
  reporterName: 'Asha Patel',
  cityName: 'Surat',
  bookingId: UUID_2,
  bookingReference: 'CLK-1004',
  status: 'OPEN',
  decision: null,
  decisionNote: null,
  decidedByName: null,
  createdAt: AT,
  decidedAt: null,
};

const detail = {
  ...report,
  review: {
    id: UUID_2,
    rating: 1,
    comment: 'Terrible',
    isPublished: true,
    photographerId: UUID,
    photographerName: 'Asha Patel',
    authorName: 'Rohan Shah',
    createdAt: AT,
    updatedAt: AT,
  },
  reportedReview: { rating: 1, comment: 'Terrible' },
  person: { kind: 'USER', id: UUID, name: 'Rohan Shah', warnings: 0, openReports: 0 },
  otherOpenReports: 0,
  history: [],
  allowedDecisions: ['HIDE', 'KEEP', 'WARN', 'DISMISS'],
};

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isApiError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

function clientApi(reply: Parameters<typeof mockFetch>[0]) {
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch(reply);
  return { api: createApiClient({ baseUrl: BASE, fetch, tokens }), calls };
}

describe('client reviews, reports and blocks (ADR-0027 D4)', () => {
  it('reads my review, which is null before one is written', async () => {
    const { api, calls } = clientApi(() => ok(null));
    expect(await api.reviews.mine(UUID_2)).toBeNull();
    expect(calls[0]).toMatchObject({ url: `${BASE}/bookings/${UUID_2}/review`, method: 'GET' });
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
  });

  it('saves a review and surfaces the closed edit window as its code', async () => {
    const { api, calls } = clientApi(() =>
      calls.length === 1
        ? ok(review)
        : fail(409, 'REVIEW_EDIT_WINDOW_CLOSED', 'Reviews can be edited for 7 days'),
    );
    expect((await api.reviews.save(UUID_2, { rating: 5, comment: 'Lovely' })).rating).toBe(5);
    expect(calls[0]).toMatchObject({
      url: `${BASE}/bookings/${UUID_2}/review`,
      method: 'POST',
      body: { rating: 5, comment: 'Lovely' },
    });
    const err = await rejection(api.reviews.save(UUID_2, { rating: 4 }));
    expect(err).toMatchObject({ status: 409, code: 'REVIEW_EDIT_WINDOW_CLOSED' });
  });

  it('never puts a non-uuid booking id in a path', async () => {
    const { api, calls } = clientApi(() => ok(review));
    expect(await rejection(api.reviews.mine('../admin'))).toMatchObject({ code: 'INVALID_ID' });
    expect(calls).toHaveLength(0);
  });

  it('reports a photographer about a shared booking', async () => {
    const { api, calls } = clientApi(() => ok(receipt, 201));
    const body = {
      targetKind: 'PHOTOGRAPHER',
      targetId: UUID,
      bookingId: UUID_2,
      reason: 'UNSAFE_BEHAVIOUR',
    } as const;
    expect(await api.reports.create(body)).toEqual(receipt);
    expect(calls[0]).toMatchObject({ url: `${BASE}/reports`, method: 'POST', body });
  });

  it('lists, blocks and unblocks photographers', async () => {
    const blocked = { photographerId: UUID, name: 'Asha Patel', blockedAt: AT };
    const replies = [ok([blocked]), ok(blocked), ok({ photographerId: UUID, blocked: false })];
    const { api, calls } = clientApi(() => replies.shift() ?? ok(null));
    expect(await api.blocks.list()).toEqual([blocked]);
    expect(await api.blocks.block({ photographerId: UUID })).toEqual(blocked);
    expect(await api.blocks.unblock(UUID)).toEqual({ photographerId: UUID, blocked: false });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${BASE}/me/blocks`,
      `POST ${BASE}/me/blocks`,
      `POST ${BASE}/me/blocks/${UUID}/unblock`,
    ]);
    expect(calls[1]?.body).toEqual({ photographerId: UUID });
  });
});

describe('Pro reports (ADR-0027 D4)', () => {
  it('reports a client with the photographer token', async () => {
    const tokens = memoryTokens({ access: 'pro-access', refresh: 'pro-refresh' });
    const { fetch, calls } = mockFetch(() => ok(receipt, 201));
    const api = createProApiClient({ baseUrl: BASE, fetch, tokens });
    const body = { targetKind: 'USER', targetId: UUID, bookingId: UUID_2, reason: 'HARASSMENT' };
    expect(await api.reports.create(body as never)).toEqual(receipt);
    expect(calls[0]).toMatchObject({ url: `${BASE}/pro/reports`, method: 'POST', body });
    expect(calls[0]?.headers.authorization).toBe('Bearer pro-access');
  });
});

describe('admin moderation desk (ADR-0027 D4)', () => {
  function adminApi(reply: Parameters<typeof mockFetch>[0]) {
    const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
    const { fetch, calls } = mockFetch(reply);
    const api = createAdminApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired: vi.fn() });
    return { api, calls };
  }

  it('lists reports with the status filter and paging', async () => {
    const { api, calls } = adminApi(() => ok({ items: [report], nextCursor: null }));
    const page = await api.moderation.reports.list({ status: 'DECIDED', limit: 20 });
    expect(page.items[0]?.reason).toBe('ABUSIVE');
    expect(calls[0]?.url).toBe(`${BASE}/admin/moderation/reports?limit=20&status=DECIDED`);
    await api.moderation.reports.list();
    expect(calls[1]?.url).toBe(`${BASE}/admin/moderation/reports?limit=50&status=OPEN`);
  });

  it('reads one report with its target', async () => {
    const { api, calls } = adminApi(() => ok(detail));
    expect((await api.moderation.reports.get(UUID)).review?.comment).toBe('Terrible');
    expect(calls[0]?.url).toBe(`${BASE}/admin/moderation/reports/${UUID}`);
  });

  it('decides with an Idempotency-Key and validates the note before sending', async () => {
    const { api, calls } = adminApi(() => ok({ ...detail, status: 'ACTIONED', decision: 'HIDE' }));
    const decided = await api.moderation.reports.decide(
      UUID,
      { decision: 'HIDE', note: 'Abusive language' },
      { idempotencyKey: KEY },
    );
    expect(decided.decision).toBe('HIDE');
    expect(calls[0]).toMatchObject({
      url: `${BASE}/admin/moderation/reports/${UUID}/decide`,
      method: 'POST',
      body: { decision: 'HIDE', note: 'Abusive language' },
    });
    expect(calls[0]?.headers['idempotency-key']).toBe(KEY);
    const err = await rejection(
      api.moderation.reports.decide(UUID, { decision: 'KEEP', note: '' }, { idempotencyKey: KEY }),
    );
    expect(err.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(1);
  });
});
