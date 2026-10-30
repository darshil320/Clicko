import { describe, expect, it, vi } from 'vitest';
import { createAdminApiClient } from '../admin-client.js';
import { isApiError } from '../errors.js';
import { fail, memoryTokens, mockFetch, ok, UUID, UUID_2 } from './helpers.js';

const BASE = 'http://localhost:4000';
const KEY = '0b6f8e9a-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
const CITY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const AT = '2026-12-07T10:00:00+05:30';

function client(reply: Parameters<typeof mockFetch>[0]) {
  const tokens = memoryTokens({ access: 'access-1', refresh: 'refresh-1' });
  const { fetch, calls } = mockFetch(reply);
  const api = createAdminApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired: vi.fn() });
  return { api, calls };
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

const card = {
  id: UUID,
  photographerId: UUID_2,
  fullName: 'Asha Patel',
  phone: '+919825088001',
  cityId: CITY,
  cityName: 'Surat',
  source: 'WALK_IN',
  portfolioUrl: null,
  yearsExperience: 4,
  requestedMaxTier: null,
  stage: 'SCREENING',
  stageSince: AT,
  createdAt: AT,
  documents: { pending: 2, approved: 0, rejected: 0 },
};

const ticket = {
  id: UUID,
  reference: 'TKT-1042',
  subject: 'Photographer arrived late',
  category: 'GRIEVANCE',
  isGrievance: true,
  status: 'OPEN',
  raisedByKind: 'USER',
  contactName: 'Priya Sharma',
  contactPhone: '+919700089002',
  contactEmail: null,
  bookingId: null,
  bookingReference: null,
  assignedToId: null,
  assignedToName: null,
  receivedAt: AT,
  ackDueAt: '2026-12-09T10:00:00+05:30',
  acknowledgedAt: null,
  resolveDueAt: '2027-01-06T10:00:00+05:30',
  resolvedAt: null,
  lastMessageAt: AT,
  messageCount: 1,
  resolutionSummary: null,
  messages: [
    {
      id: UUID_2,
      authorKind: 'CUSTOMER',
      authorName: 'Priya Sharma',
      body: 'Late by 40 minutes',
      isInternal: false,
      createdAt: AT,
    },
  ],
};

describe('admin supply routes (ADR-0026 D5)', () => {
  it('moves an application with a reason and an Idempotency-Key', async () => {
    const { api, calls } = client(() => ok(card));
    const res = await api.supply.applications.move(
      UUID,
      { toStage: 'SCREENING', note: 'Strong portfolio' },
      { idempotencyKey: KEY },
    );
    expect(res.stage).toBe('SCREENING');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${BASE}/admin/supply/applications/${UUID}/move`,
      body: { toStage: 'SCREENING', note: 'Strong portfolio' },
    });
    expect(calls[0]?.headers['Idempotency-Key'] ?? calls[0]?.headers['idempotency-key']).toBe(KEY);
  });

  it('refuses a move without a reason before it leaves the browser', async () => {
    const { api, calls } = client(() => ok(card));
    const error = await rejection(
      api.supply.applications.move(
        UUID,
        { toStage: 'SCREENING', note: '' },
        { idempotencyKey: KEY },
      ),
    );
    expect(error.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('asks for a KYC link and parses it', async () => {
    const { api, calls } = client(() =>
      ok({ url: 'https://files.example/signed', expiresAt: AT, opensInBrowser: true }),
    );
    const link = await api.supply.kyc.viewLink(UUID, { idempotencyKey: KEY });
    expect(link.opensInBrowser).toBe(true);
    expect(calls[0]?.url).toBe(`${BASE}/admin/supply/kyc/${UUID}/view-link`);
  });

  it('builds the directory query and never puts a bad id in a path', async () => {
    const { api, calls } = client(() => ok({ items: [], nextCursor: null }));
    await api.supply.photographers.list({ q: 'Asha', status: 'ACTIVE', cityId: CITY });
    expect(calls[0]?.url).toBe(
      `${BASE}/admin/supply/photographers?limit=50&q=Asha&cityId=${CITY}&status=ACTIVE`,
    );
    const error = await rejection(
      Promise.resolve().then(() => api.supply.photographers.get('../staff')),
    );
    expect(error.code).toBe('INVALID_ID');
  });

  it('surfaces the server’s message on a refused approval', async () => {
    const { api } = client(() =>
      fail(422, 'VERIFICATION_INCOMPLETE', 'Approve the PAN card first'),
    );
    const error = await rejection(
      api.supply.applications.move(
        UUID,
        { toStage: 'APPROVED', note: 'Ready' },
        { idempotencyKey: KEY },
      ),
    );
    expect(error).toMatchObject({ status: 422, code: 'VERIFICATION_INCOMPLETE' });
  });
});

describe('admin care routes (ADR-0026 D6)', () => {
  it('lists tickets by view and parses the thread', async () => {
    const { api, calls } = client(() => ok({ items: [ticket], nextCursor: null }));
    const page = await api.care.tickets.list({ view: 'OVERDUE' });
    expect(page.items[0]?.reference).toBe('TKT-1042');
    expect(calls[0]?.url).toBe(`${BASE}/admin/care/tickets?limit=50&view=OVERDUE`);
  });

  it('posts a reply', async () => {
    const { api, calls } = client(() => ok(ticket));
    await api.care.tickets.message(
      UUID,
      { kind: 'REPLY', body: 'Sorry about this' },
      { idempotencyKey: KEY },
    );
    expect(calls[0]).toMatchObject({
      url: `${BASE}/admin/care/tickets/${UUID}/messages`,
      body: { kind: 'REPLY', body: 'Sorry about this' },
    });
  });

  it('normalises a booking reference when opening a quality issue', async () => {
    const { api, calls } = client(() => fail(404, 'BOOKING_NOT_FOUND', 'No booking'));
    await rejection(
      api.care.quality.open(
        { bookingReference: ' clk-1004 ', complaint: 'Half the photos are out of focus' },
        { idempotencyKey: KEY },
      ),
    );
    expect(calls[0]?.body).toMatchObject({ bookingReference: 'CLK-1004' });
  });

  it('refuses a claim approval above the cap client-side', async () => {
    const { api, calls } = client(() => ok({}));
    const error = await rejection(
      api.care.claims.approve(
        UUID,
        { amountPaise: 20_000_001, note: 'Quote' },
        { idempotencyKey: KEY },
      ),
    );
    expect(error.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('refuses a money outcome without an amount client-side', async () => {
    const { api, calls } = client(() => ok({}));
    const error = await rejection(
      api.care.quality.resolve(
        UUID,
        { outcome: 'PARTIAL_REFUND', note: 'Agreed with client' },
        { idempotencyKey: KEY },
      ),
    );
    expect(error.code).toBe('INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });
});
