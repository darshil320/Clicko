/**
 * ADR-0034 end to end: the videography rate card from quote to a paid booking. Semi-Pro
 * ("Advanced") · Portrait · Surat · 2 h · videographer · 5 reels · raw footage, a week ahead in
 * wedding season (the base takes the 1.15× surge; the video lines take nothing, Invariant 6).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { TEST_DATABASE_URL } from './test-support/scratch-db';

const NOW = new Date('2026-11-17T06:30:00.000Z'); // Tuesday 17 Nov, 12:00 IST
const START = new Date('2026-11-24T06:30:00.000Z').toISOString(); // Tuesday 24 Nov, 12:00 IST
const PHONE = '+919999552211';

const VIDEO_ADDONS = [
  { code: 'VIDEOGRAPHER', quantity: 1 },
  { code: 'REELS', quantity: 5 },
  { code: 'RAW_FOOTAGE', quantity: 1 },
];

const quoteBody = (overrides: Json = {}) => ({
  tier: 'SEMI_PRO',
  categoryCode: 'PORTRAIT',
  pincode: '395007',
  scheduledStart: START,
  hours: 2,
  addons: VIDEO_ADDONS,
  ...overrides,
});

// base 275000 × 2 × 1.15 = 632500 · video 300000 × 2 · reels 200000 × 5 · raw 100000
const BASE = 632_500;
const ADDONS = 1_700_000;
const SUBTOTAL = BASE + ADDONS;
const GST = 419_850; // 18% of 2332500
const TOTAL = SUBTOTAL + GST;

describe.runIf(TEST_DATABASE_URL)('videography: quote → book → pay (ADR-0034)', () => {
  let e2e: E2eApp;
  let token: string;
  let bookingId: string;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    token = await e2e.login(PHONE);
  }, 60_000);

  afterAll(async () => {
    await e2e?.close();
  });

  it('quotes the video lines from ruleset 2026.11.14, unmultiplied, with GST on all of it', async () => {
    const res = await e2e.call('POST', '/pricing/quote', { body: quoteBody() });

    expect(res.status).toBe(200);
    const quote = res.json.data;
    expect(quote.rulesetVersion).toBe('2026.11.14');
    expect(quote.lines).toEqual(
      expect.arrayContaining([
        {
          code: 'ADDON_VIDEOGRAPHER',
          label: 'Videographer',
          detail: '₹3,000/hr × 2 hrs',
          amountPaise: 600_000,
        },
        { code: 'ADDON_REELS', label: 'Reels', detail: '₹2,000 × 5', amountPaise: 1_000_000 },
        { code: 'ADDON_RAW_FOOTAGE', label: 'Raw footage', amountPaise: 100_000 },
      ]),
    );
    expect(quote).toMatchObject({ subtotalPaise: SUBTOTAL, totalPaise: TOTAL });
    expect(quote.gst).toMatchObject({ cgstPaise: GST / 2, sgstPaise: GST / 2, igstPaise: 0 });
  });

  it('prices 4 reels at ₹3,000 each and refuses reels without a videographer', async () => {
    const four = await e2e.call('POST', '/pricing/quote', {
      body: quoteBody({ addons: [VIDEO_ADDONS[0], { code: 'REELS', quantity: 4 }] }),
    });
    expect(four.json.data.lines).toContainEqual(
      expect.objectContaining({ code: 'ADDON_REELS', amountPaise: 1_200_000 }),
    );

    const alone = await e2e.call('POST', '/pricing/quote', {
      body: quoteBody({ addons: [{ code: 'REELS', quantity: 2 }] }),
    });
    expect(alone.status).toBe(422);
    expect(alone.json.error.code).toBe('ADDON_REQUIRES_ADDON');
  });

  it('refuses a second raw footage and more than 20 reels', async () => {
    const twoRaw = await e2e.call('POST', '/pricing/quote', {
      body: quoteBody({ addons: [VIDEO_ADDONS[0], { code: 'RAW_FOOTAGE', quantity: 2 }] }),
    });
    expect(twoRaw.status).toBe(422);
    expect(twoRaw.json.error.code).toBe('INVALID_ADDON_QUANTITY');

    const tooMany = await e2e.call('POST', '/pricing/quote', {
      body: quoteBody({ addons: [VIDEO_ADDONS[0], { code: 'REELS', quantity: 21 }] }),
    });
    expect(tooMany.status).toBe(400);
  });

  it('books it: the snapshot and booking_addons freeze every video line', async () => {
    const res = await e2e.call('POST', '/bookings', {
      token,
      idempotencyKey: 'video-booking-0001',
      body: {
        ...quoteBody(),
        venueAddress: '12 Ghod Dod Road, Surat',
        booker: { name: 'Ananya Iyer', phone: PHONE },
        modelReleaseConsent: false,
        acceptedTermsVersion: '2.0',
      },
    });

    expect(res.status).toBe(201);
    const { booking } = res.json.data;
    expect(booking).toMatchObject({ status: 'QUOTED', tier: 'SEMI_PRO', totalPaise: TOTAL });
    bookingId = booking.id;

    const [snapshot] = await e2e.db.sql<
      { ruleset_version: string; base: string; addons: string; payout: string }[]
    >`
      SELECT ruleset_version, base_amount_paise AS base, addons_amount_paise AS addons,
             expected_payout_paise AS payout
      FROM booking_price_snapshots WHERE booking_id = ${bookingId} AND sequence = 1`;
    expect(snapshot).toEqual({
      ruleset_version: '2026.11.14',
      base: String(BASE),
      addons: String(ADDONS),
      payout: String(Math.round(SUBTOTAL * 0.62)), // tier share on base + add-ons, 1446150
    });

    const addons = await e2e.db.sql<{ code: string; quantity: number; amount: string }[]>`
      SELECT a.code, ba.quantity, ba.amount_paise AS amount
      FROM booking_addons ba JOIN addons a ON a.id = ba.addon_id
      WHERE ba.booking_id = ${bookingId} ORDER BY a.code`;
    expect(addons).toEqual([
      { code: 'RAW_FOOTAGE', quantity: 1, amount: '100000' },
      { code: 'REELS', quantity: 5, amount: '1000000' },
      { code: 'VIDEOGRAPHER', quantity: 1, amount: '600000' },
    ]);
  });

  it('invoices the advance with GST that reconciles and a balanced ledger', async () => {
    const pay = await e2e.call('POST', `/bookings/${bookingId}/pay`, {
      token,
      idempotencyKey: 'video-pay-0001',
    });
    expect(pay.status).toBe(200);
    const sim = await e2e.call('POST', `/dev/payments/${pay.json.data.paymentId}/simulate`, {
      body: { outcome: 'CAPTURED' },
    });
    expect(sim.json.data.outcome).toBe('APPLIED');

    const { booking, invoices } = (await e2e.call('GET', `/bookings/${bookingId}`, { token })).json
      .data;
    expect(booking).toMatchObject({ status: 'CONFIRMED', amountPaidPaise: Math.ceil(TOTAL / 2) });
    const [inv] = invoices;
    expect(inv).toMatchObject({
      purpose: 'ADVANCE',
      totalPaise: Math.ceil(TOTAL / 2),
      igstPaise: 0,
    });
    expect(inv.taxablePaise + inv.cgstPaise + inv.sgstPaise).toBe(inv.totalPaise);

    const txns = await e2e.db.sql<{ debit: string; credit: string }[]>`
      SELECT sum(amount_paise) FILTER (WHERE direction = 'DEBIT') AS debit,
             sum(amount_paise) FILTER (WHERE direction = 'CREDIT') AS credit
      FROM ledger_entries WHERE booking_id = ${bookingId} GROUP BY txn_id`;
    expect(txns.length).toBeGreaterThan(0);
    for (const t of txns) expect(t.debit).toBe(t.credit);
  });
});
