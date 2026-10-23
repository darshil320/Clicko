import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainOutbox } from './test-support/dispatch-fixtures';
import type { E2eApp, Json } from './test-support/e2e-app';
import { startE2eApp } from './test-support/e2e-app';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';

const NOW = new Date('2026-11-10T06:30:00.000Z'); // Tuesday 12:00 IST
const DAY = 24 * 60 * 60_000;
const PRO_PHONE = '+919825099001';
const CLIENT_PHONE = '+919700000777';

describe.runIf(TEST_DATABASE_URL)(
  'dispatch end to end: book → pay → dispatch → PRO_LOGIN → offer → accept',
  () => {
    let e2e: E2eApp;
    let clientToken: string;
    let proToken: string;
    let booking: Json;
    let offer: Json;

    beforeAll(async () => {
      e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
      await insertPhotographer(e2e.db.sql, {
        phone: PRO_PHONE,
        name: 'Meera Joshi',
        km: 3,
        categories: [{ code: 'PORTRAIT', tier: 'EXPERT' }],
      });
      clientToken = await e2e.login(CLIENT_PHONE);
    }, 60_000);

    afterAll(async () => {
      await e2e?.close();
    });

    it('a client books and pays; the outbox tick starts dispatch', async () => {
      const created = await e2e.call('POST', '/bookings', {
        token: clientToken,
        idempotencyKey: 'e2e-dispatch-create-1',
        body: {
          tier: 'PROFESSIONAL',
          categoryCode: 'PORTRAIT',
          pincode: '395007',
          scheduledStart: new Date(NOW.getTime() + 5 * DAY).toISOString(),
          hours: 2,
          venueAddress: '4 Athwalines, Surat',
          venueLandmark: 'Opposite the lake',
          booker: { name: 'Rohan Shah', phone: CLIENT_PHONE },
          modelReleaseConsent: false,
          acceptedTermsVersion: '2.0',
        },
      });
      expect(created.status).toBe(201);
      booking = created.json.data.booking;
      const pay = await e2e.call('POST', `/bookings/${booking.id}/pay`, {
        token: clientToken,
        idempotencyKey: 'e2e-dispatch-pay-1',
      });
      const sim = await e2e.call('POST', `/dev/payments/${pay.json.data.paymentId}/simulate`, {
        body: { outcome: 'CAPTURED' },
      });
      expect(sim.json.data.outcome).toBe('APPLIED');

      await drainOutbox(e2e);
      const detail = await e2e.call('GET', `/bookings/${booking.id}`, { token: clientToken });
      expect(detail.json.data.booking.status).toBe('DISPATCHING');
      expect(detail.json.data.timeline.map((t: Json) => t.toStatus)).toEqual([
        'DRAFT',
        'QUOTED',
        'ADVANCE_PENDING',
        'CONFIRMED',
        'DISPATCHING',
      ]);
    });

    it('the photographer signs in with PRO_LOGIN and sees the offer without the address', async () => {
      proToken = await e2e.proLogin(PRO_PHONE);
      const offers = await e2e.call('GET', '/pro/offers', { token: proToken });
      expect(offers.status).toBe(200);
      expect(offers.json.data).toHaveLength(1);
      offer = offers.json.data[0];
      expect(offer).toMatchObject({
        bookingId: booking.id,
        bookingReference: booking.reference,
        categoryCode: 'PORTRAIT',
        tier: 'PROFESSIONAL',
        scheduledHours: 2,
        area: { pincode: '395007', cityName: 'Surat' },
        clientDisplayName: 'Rohan S.',
        isBroadcast: false,
      });
      expect(offer).not.toHaveProperty('venue');
      expect(JSON.stringify(offers.json)).not.toMatch(/Athwalines|Opposite the lake|\+91970/);
    });

    it('accepting assigns the booking and reveals the address in /pro/assignments', async () => {
      const accepted = await e2e.call('POST', `/pro/offers/${offer.attemptId}/accept`, {
        token: proToken,
        idempotencyKey: 'e2e-dispatch-accept-1',
      });
      expect(accepted.status).toBe(200);
      expect(accepted.json.data).toEqual({
        attemptId: offer.attemptId,
        assignmentId: expect.any(String),
        bookingId: booking.id,
        status: 'ASSIGNED',
      });

      const replay = await e2e.call('POST', `/pro/offers/${offer.attemptId}/accept`, {
        token: proToken,
        idempotencyKey: 'e2e-dispatch-accept-1',
      });
      expect(replay.headers.get('idempotent-replayed')).toBe('true');

      const detail = await e2e.call('GET', `/bookings/${booking.id}`, { token: clientToken });
      expect(detail.json.data.booking.status).toBe('ASSIGNED');
      const rows = await e2e.db.sql`SELECT 1 FROM assignments WHERE booking_id = ${booking.id}`;
      expect(rows).toHaveLength(1);

      const mine = await e2e.call('GET', '/pro/assignments', { token: proToken });
      expect(mine.json.data).toEqual([
        expect.objectContaining({
          bookingId: booking.id,
          payoutPaise: offer.payoutPaise,
          clientDisplayName: 'Rohan S.',
          venue: expect.objectContaining({
            address: '4 Athwalines, Surat',
            landmark: 'Opposite the lake',
            pincode: '395007',
          }),
        }),
      ]);
      expect((await e2e.call('GET', '/pro/offers', { token: proToken })).json.data).toEqual([]);
    });

    it('the dev dispatch desk shows rounds, attempts and names (development only)', async () => {
      const desk = await e2e.call('GET', `/dev/dispatch/bookings/${booking.id}`);
      expect(desk.status).toBe(200);
      expect(desk.json.data).toMatchObject({
        bookingId: booking.id,
        bookingStatus: 'ASSIGNED',
        rounds: [
          {
            wave: 1,
            outcome: 'FILLED',
            attempts: [{ photographerName: 'Meera Joshi', outcome: 'ACCEPTED' }],
          },
        ],
        assignments: [{ photographerName: 'Meera Joshi', status: 'ASSIGNED' }],
      });
    });

    it('an unknown number gets the same OTP response shape, but no SMS and no session', async () => {
      const phone = '+919825099999';
      const req = await e2e.call('POST', '/pro/auth/otp/request', { body: { phone } });
      expect(req.status).toBe(200);
      expect(Object.keys(req.json.data).sort()).toEqual([
        'challengeId',
        'expiresAt',
        'resendAfterSeconds',
      ]);
      // A decoy job is queued exactly like a real one, and sends nothing.
      expect(await e2e.runDueJobs()).toBe(1);
      expect(e2e.sms.last.has(phone)).toBe(false);
      const verify = await e2e.call('POST', '/pro/auth/otp/verify', {
        body: { challengeId: req.json.data.challengeId, phone, code: '123456' },
      });
      expect(verify.status).toBe(401);
      expect(verify.json.error.code).toBe('OTP_INVALID');
    });

    it('refreshes a photographer session only at /pro/auth/refresh', async () => {
      e2e.advance(31_000);
      const req = await e2e.call('POST', '/pro/auth/otp/request', { body: { phone: PRO_PHONE } });
      await e2e.runDueJobs();
      const verify = await e2e.call('POST', '/pro/auth/otp/verify', {
        body: {
          challengeId: req.json.data.challengeId,
          phone: PRO_PHONE,
          code: e2e.sms.last.get(PRO_PHONE),
        },
      });
      expect(verify.json.data.photographer).toMatchObject({ displayName: 'Meera Joshi' });
      const refreshToken = verify.json.data.refreshToken as string;
      const wrongRoute = await e2e.call('POST', '/auth/refresh', { body: { refreshToken } });
      expect(wrongRoute.status).toBe(401);
      const refreshed = await e2e.call('POST', '/pro/auth/refresh', { body: { refreshToken } });
      expect(refreshed.status).toBe(200);
      expect(refreshed.json.data.refreshToken).not.toBe(refreshToken);

      // Sign-out revokes the session server-side (security review M7).
      const current = refreshed.json.data.refreshToken as string;
      const out = await e2e.call('POST', '/pro/auth/logout', { body: { refreshToken: current } });
      expect(out.json.data).toEqual({ loggedOut: true });
      const after = await e2e.call('POST', '/pro/auth/refresh', {
        body: { refreshToken: current },
      });
      expect(after.status).toBe(401);
    });

    it('a client OTP cannot open a photographer session', async () => {
      const req = await e2e.call('POST', '/auth/otp/request', { body: { phone: PRO_PHONE } });
      await e2e.runDueJobs();
      const code = e2e.sms.last.get(PRO_PHONE);
      const asPro = await e2e.call('POST', '/pro/auth/otp/verify', {
        body: { challengeId: req.json.data.challengeId, phone: PRO_PHONE, code },
      });
      expect(asPro.status).toBe(401);
    });
  },
);
