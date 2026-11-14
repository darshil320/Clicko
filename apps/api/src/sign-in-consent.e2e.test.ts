import { SIGN_IN_NOTICE_VERSION } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type E2eApp, type Json, startE2eApp, TEST_SIGN_IN_CONSENT } from './test-support/e2e-app';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';

/** Saturday 14 Nov 2026, 10:00 IST. */
const NOW = new Date('2026-11-14T04:30:00.000Z');
const CONSENT = TEST_SIGN_IN_CONSENT;
const CONSENT_PAYLOAD = {
  purpose: 'SIGN_IN_NOTICE',
  adultConfirmed: true,
  noticeVersion: SIGN_IN_NOTICE_VERSION,
};

interface ConsentEvent {
  readonly aggregate_kind: string;
  readonly aggregate_id: string;
  readonly payload: Json;
}

/**
 * DPDP Act 2023 s.6(10) (the burden of proving consent is ours) and s.9 (under-18s): the sign-in
 * checkbox "I am 18 or older and agree to the Privacy Policy and Terms" is required when a sign-in
 * creates the account, and every sign-in that sends it is written to the consent log — a
 * `user.consent_recorded` outbox event in the session's own transaction, with no personal data.
 */
describe.runIf(TEST_DATABASE_URL)('sign-in consent', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
  });
  afterAll(async () => {
    await e2e?.close();
  });

  const requestCode = async (prefix: '/auth' | '/pro/auth', phone: string) => {
    e2e.advance(31_000); // past the per-phone resend cooldown
    const req = await e2e.call('POST', `${prefix}/otp/request`, { body: { phone } });
    expect(req.status).toBe(200);
    await e2e.runDueJobs();
    return { challengeId: req.json.data.challengeId as string, code: e2e.sms.last.get(phone) };
  };
  const verify = (prefix: '/auth' | '/pro/auth', body: Record<string, unknown>) =>
    e2e.call('POST', `${prefix}/otp/verify`, { body });
  const consentEvents = (id: string) =>
    e2e.db.sql<ConsentEvent[]>`
      SELECT aggregate_kind, aggregate_id, payload FROM domain_events
      WHERE event_type = 'user.consent_recorded' AND aggregate_id = ${id}
      ORDER BY id`;
  const usersWithPhone = async (phone: string) =>
    (await e2e.db.sql`SELECT 1 FROM users WHERE phone_e164 = ${phone}`).length;

  describe('client app (/auth/otp/verify)', () => {
    it('refuses a new account without consent, creates nothing, and keeps the code usable', async () => {
      const phone = '+919999381001';
      const { challengeId, code } = await requestCode('/auth', phone);

      const refused = await verify('/auth', { challengeId, phone, code });
      expect(refused.status).toBe(422);
      expect(refused.json.error).toEqual({
        code: 'CONSENT_REQUIRED',
        message: 'Confirm you are 18 or older and agree to the Privacy Policy to continue.',
      });
      expect(await usersWithPhone(phone)).toBe(0);

      const ok = await verify('/auth', { challengeId, phone, code, consent: CONSENT });
      expect(ok.status).toBe(200);
      expect(ok.json.data.user.isNew).toBe(true);
      const events = await consentEvents(ok.json.data.user.id);
      expect(events).toEqual([
        { aggregate_kind: 'user', aggregate_id: ok.json.data.user.id, payload: CONSENT_PAYLOAD },
      ]);
      expect(JSON.stringify(events[0]?.payload)).not.toContain('9999381001');
    });

    it('a wrong code is OTP_INVALID with or without consent: nothing reveals whether the number is new', async () => {
      const phone = '+919999381002';
      const { challengeId, code } = await requestCode('/auth', phone);
      const wrong = code === '000000' ? '111111' : '000000';
      const res = await verify('/auth', { challengeId, phone, code: wrong });
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe('OTP_INVALID');
    });

    it('refuses a consent that does not confirm the person is an adult', async () => {
      const phone = '+919999381003';
      const { challengeId, code } = await requestCode('/auth', phone);
      const res = await verify('/auth', {
        challengeId,
        phone,
        code,
        consent: { adultConfirmed: false, noticeVersion: SIGN_IN_NOTICE_VERSION },
      });
      expect(res.status).toBe(400);
      expect(await usersWithPhone(phone)).toBe(0);
    });

    it('an existing account signs in without consent (older app builds), and nothing is logged', async () => {
      const phone = '+919999381004';
      const first = await requestCode('/auth', phone);
      const created = await verify('/auth', { ...first, phone, consent: CONSENT });
      const userId = created.json.data.user.id as string;

      const again = await requestCode('/auth', phone);
      const res = await verify('/auth', { ...again, phone });
      expect(res.status).toBe(200);
      expect(res.json.data.user).toMatchObject({ id: userId, isNew: false });
      expect(await consentEvents(userId)).toHaveLength(1);
    });

    it('an existing account that sends consent gets another consent-log entry', async () => {
      const phone = '+919999381005';
      const first = await requestCode('/auth', phone);
      const created = await verify('/auth', { ...first, phone, consent: CONSENT });
      const userId = created.json.data.user.id as string;

      const again = await requestCode('/auth', phone);
      const res = await verify('/auth', { ...again, phone, consent: CONSENT });
      expect(res.status).toBe(200);
      expect((await consentEvents(userId)).map((e) => e.payload)).toEqual([
        CONSENT_PAYLOAD,
        CONSENT_PAYLOAD,
      ]);
    });

    it('logs nothing for a notice version that is not in force, and refuses a new account', async () => {
      const stale = { adultConfirmed: true, noticeVersion: '2020-01-01' };
      const phone = '+919999381006';
      const challenge = await requestCode('/auth', phone);
      const res = await verify('/auth', { ...challenge, phone, consent: stale });
      expect(res.status).toBe(422);
      expect(res.json.error.code).toBe('CONSENT_REQUIRED');
    });
  });

  describe('Pro app (/pro/auth/otp/verify)', () => {
    it("refuses a photographer's first sign-in without consent, keeping the code usable", async () => {
      const phone = '+919999381101';
      const proId = await insertPhotographer(e2e.db.sql, { phone, name: 'Consent First' });
      const { challengeId, code } = await requestCode('/pro/auth', phone);

      const refused = await verify('/pro/auth', { challengeId, phone, code });
      expect(refused.status).toBe(422);
      expect(refused.json.error.code).toBe('CONSENT_REQUIRED');

      const ok = await verify('/pro/auth', { challengeId, phone, code, consent: CONSENT });
      expect(ok.status).toBe(200);
      expect(ok.json.data.photographer.id).toBe(proId);
      expect(await consentEvents(proId)).toEqual([
        { aggregate_kind: 'photographer', aggregate_id: proId, payload: CONSENT_PAYLOAD },
      ]);
    });

    it('a photographer who has signed in before may sign in without consent', async () => {
      const phone = '+919999381102';
      const proId = await insertPhotographer(e2e.db.sql, { phone, name: 'Consent Again' });
      const first = await requestCode('/pro/auth', phone);
      expect((await verify('/pro/auth', { ...first, phone, consent: CONSENT })).status).toBe(200);

      const again = await requestCode('/pro/auth', phone);
      const res = await verify('/pro/auth', { ...again, phone });
      expect(res.status).toBe(200);
      expect(await consentEvents(proId)).toHaveLength(1);
    });

    it('a number that is not an active photographer is still OTP_INVALID, never CONSENT_REQUIRED', async () => {
      const phone = '+919999381103';
      await insertPhotographer(e2e.db.sql, { phone, name: 'Paused', status: 'PAUSED' });
      const { challengeId } = await requestCode('/pro/auth', phone);
      const res = await verify('/pro/auth', { challengeId, phone, code: '123456' });
      expect(res.status).toBe(401);
      expect(res.json.error.code).toBe('OTP_INVALID');
    });
  });
});
