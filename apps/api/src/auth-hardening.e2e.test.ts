import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_LOGIN_POLICY } from './modules/admin/auth/login-store';
import { TokenService } from './modules/auth/token.service';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff } from './test-support/staff-fixtures';

const NOW = new Date('2026-11-10T06:30:00.000Z');

/** Security audit (identity and access, 31 Oct): H1, L1, L3 and M2 through the real HTTP stack. */
describe.runIf(TEST_DATABASE_URL)('identity and access hardening (e2e)', () => {
  let e2e: E2eApp;
  let phoneSeq = 0;
  const nextPhone = () => {
    phoneSeq += 1;
    return `+91981${String(phoneSeq).padStart(7, '0')}`;
  };
  const requestOtp = (forwardedFor: string, phone = nextPhone()) =>
    e2e.call('POST', '/auth/otp/request', {
      body: { phone },
      headers: { 'x-forwarded-for': forwardedFor },
    });

  beforeAll(async () => {
    // One load balancer hop: req.ip is the X-Forwarded-For entry it appended.
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test', env: { TRUST_PROXY_HOPS: '1' } });
  }, 60_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('H1: OTP per-IP limit', () => {
    it('H1: ::ffff:1.2.3.4 and ::ffff:5.6.7.8 are separate buckets (20 from one lock out only it)', async () => {
      for (let i = 0; i < 20; i += 1) {
        const res = await requestOtp('::ffff:1.2.3.4');
        expect(res.status, JSON.stringify(res.json)).toBe(200);
      }
      const blocked = await requestOtp('::ffff:1.2.3.4');
      expect([blocked.status, blocked.json.error.code]).toEqual([429, 'RATE_LIMITED']);
      expect((await requestOtp('1.2.3.4')).status).toBe(429);
      expect((await requestOtp('::ffff:5.6.7.8')).status).toBe(200);
    });

    it('H1: stores the IPv4 address, not its ::ffff: form', async () => {
      const phone = nextPhone();
      await requestOtp('::ffff:9.8.7.6', phone);
      const [row] = await e2e.db.sql<{ ip: string }[]>`
        SELECT host(created_ip) AS ip FROM otp_challenges WHERE phone_e164 = ${phone}`;
      expect(row?.ip).toBe('9.8.7.6');
    });

    it('H1: a garbage X-Forwarded-For can neither 500 nor bypass the limit', async () => {
      const first = await requestOtp('not-an-ip');
      expect(first.status, JSON.stringify(first.json)).toBe(200);
      for (let i = 0; i < 19; i += 1) {
        expect((await requestOtp(`garbage-${i}`)).status).toBe(200);
      }
      // Every unusable address shares one bucket: the 21st is refused.
      expect((await requestOtp("1.1.1.1'; --")).status).toBe(429);
    });
  });

  describe('L1: UserGuard', () => {
    it('L1: a blocked user is refused at once, with the access token still unexpired', async () => {
      const phone = nextPhone();
      const token = await e2e.login(phone);
      expect((await e2e.call('GET', '/me', { token })).status).toBe(200);
      expect((await e2e.call('GET', '/bookings', { token })).status).toBe(200);

      await e2e.db.sql`UPDATE users SET is_blocked = true WHERE phone_e164 = ${phone}`;
      for (const path of ['/me', '/bookings']) {
        const res = await e2e.call('GET', path, { token });
        expect([res.status, res.json.error.code], path).toEqual([403, 'ACCOUNT_BLOCKED']);
      }
    });

    it('L1: client routes refuse a non-USER session (kind checked by the guard)', async () => {
      const staff = await e2e
        .get<TokenService>(TokenService)
        .issue({ kind: 'STAFF', id: '00000000-0000-4000-8000-000000000001' }, null);
      for (const path of ['/me', '/bookings']) {
        const res = await e2e.call('GET', path, { token: staff.accessToken });
        expect([res.status, res.json.error.code], path).toEqual([403, 'CLIENTS_ONLY']);
      }
    });
  });

  describe('L3: security headers', () => {
    const expectHardened = (headers: Headers | undefined) => {
      expect(headers?.get('cache-control')).toBe('no-store');
      expect(headers?.get('x-content-type-options')).toBe('nosniff');
      expect(headers?.get('referrer-policy')).toBe('no-referrer');
      expect(headers?.get('x-frame-options')).toBe('DENY');
      expect(headers?.get('x-powered-by')).toBeNull();
    };

    it('L3: auth responses are no-store and carry the standard security headers', async () => {
      expectHardened((await requestOtp('7.7.7.7')).headers);
      const token = await e2e.login(nextPhone());
      expectHardened((await e2e.call('GET', '/me', { token })).headers);
    });

    it('L3: errors carry them too', async () => {
      expectHardened((await e2e.call('GET', '/me')).headers);
      expectHardened((await e2e.call('GET', '/no-such-route')).headers);
    });
  });

  describe('M2: staff sign-in lockout per (email, IP)', () => {
    const staffLogin = (email: string, password: string, ip: string) =>
      e2e.call('POST', '/admin/auth/login', {
        body: { email, password },
        headers: { 'x-forwarded-for': ip },
      });
    const auditRows = (action: string) =>
      e2e.db.sql<{ after_state: Json }[]>`
        SELECT after_state FROM audit_logs WHERE action = ${action} ORDER BY id`;

    it('M2: 5 failures from one IP lock that IP for the email, but the real owner elsewhere still reaches the code step', async () => {
      const owner = await bootstrapStaff(e2e, 'owner@clickco.test', 'SUPPORT');
      for (let i = 0; i < STAFF_LOGIN_POLICY.maxFailuresPerEmailIp; i += 1) {
        expect((await staffLogin('owner@clickco.test', `wrong-${i}`, '203.0.113.9')).status).toBe(
          401,
        );
      }
      // The attacker's IP is locked for this email, even with the right password.
      const attacker = await staffLogin('owner@clickco.test', owner.password, '203.0.113.9');
      expect([attacker.status, attacker.json.error.code]).toEqual([429, 'RATE_LIMITED']);
      // The owner, from their own network, is slowed but not locked out.
      const real = await staffLogin('owner@clickco.test', owner.password, '198.51.100.7');
      expect(real.status, JSON.stringify(real.json)).toBe(200);
      expect(real.json.data.step).toBe('ENROL_TOTP');
    });

    it('M2: the per-email count stays a signal: an alert row once the email crosses the threshold', async () => {
      const rows = await auditRows('staff.login_suspicious');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.after_state).toMatchObject({
        signal: 'MANY_FAILURES_FOR_EMAIL',
        failures_in_window: STAFF_LOGIN_POLICY.emailSignalThreshold + 1,
      });
    });

    it('M2: a hard per-IP ceiling still applies across emails', async () => {
      for (let i = 0; i < STAFF_LOGIN_POLICY.maxFailuresPerIp; i += 1) {
        await staffLogin(`nobody-${i}@clickco.test`, 'wrong-password', '192.0.2.44');
      }
      const res = await staffLogin('someone-else@clickco.test', 'wrong-password', '192.0.2.44');
      expect([res.status, res.json.error.code]).toEqual([429, 'RATE_LIMITED']);
    });
  });
});
