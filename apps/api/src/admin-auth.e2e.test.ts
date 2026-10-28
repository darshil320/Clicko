import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOKEN_POLICY, TokenService } from './modules/auth/token.service';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import {
  bootstrapStaff,
  cityIdOf,
  codeFor,
  signIn,
  staffToken,
} from './test-support/staff-fixtures';

const NOW = new Date('2026-12-07T04:30:00.000Z');
let keySeq = 0;
const idem = () => `admin-auth-${String(++keySeq).padStart(6, '0')}`;

/**
 * ADR-0025 D2/D3/D5 end to end: the CLI-made first SUPER_ADMIN signs in with mandatory TOTP,
 * creates and manages staff; replay, wrong codes, enumeration and lockout are refused; every
 * step lands in audit_logs.
 */
describe.runIf(TEST_DATABASE_URL)('staff sign-in and staff management', () => {
  let e2e: E2eApp;
  const secrets = new Map<string, string>();
  let admin: { id: string; password: string };
  let adminToken: string;
  let surat: string;

  const audit = async (action: string) =>
    e2e.db.sql<
      {
        actor_kind: string;
        actor_id: string | null;
        actor_email: string | null;
        entity_id: string | null;
        after_state: Json | null;
        request_id: string | null;
      }[]
    >`SELECT actor_kind, actor_id, actor_email, entity_id, after_state, request_id
      FROM audit_logs WHERE action = ${action} ORDER BY id`;

  const post = (path: string, token: string, body?: unknown) =>
    e2e.call('POST', path, {
      token,
      idempotencyKey: idem(),
      ...(body === undefined ? {} : { body }),
    });

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
    surat = await cityIdOf(e2e, 'Surat');
    admin = await bootstrapStaff(e2e, 'root@clickco.test', 'SUPER_ADMIN');
  }, 60_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('sign-in (D2)', () => {
    it('the CLI-made SUPER_ADMIN enrols an authenticator at first sign-in, then gets a session', async () => {
      expect(admin.password.length).toBeGreaterThanOrEqual(16);
      const login = await e2e.call('POST', '/admin/auth/login', {
        body: { email: 'ROOT@clickco.test', password: admin.password },
      });
      expect(login.status).toBe(200);
      expect(login.json.data).toMatchObject({ step: 'ENROL_TOTP' });
      const { secret, otpauthUri } = login.json.data.enrolment;
      expect(otpauthUri).toContain('otpauth://totp/Clickco%20Admin:root%40clickco.test');
      secrets.set('root@clickco.test', secret);
      const [stored] = await e2e.db.sql<{ totp_secret: string | null }[]>`
        SELECT totp_secret FROM staff_users WHERE id = ${admin.id}`;
      expect(stored?.totp_secret).toBeNull(); // saved only once a code proves it

      const totp = await e2e.call('POST', '/admin/auth/totp', {
        body: { challengeId: login.json.data.challengeId, code: codeFor(e2e, secret) },
      });
      expect(totp.status).toBe(200);
      expect(totp.json.data.staff).toMatchObject({
        id: admin.id,
        email: 'root@clickco.test',
        grants: [{ role: 'SUPER_ADMIN', cityId: null, cityName: null }],
      });
      const hours = (Date.parse(totp.json.data.refreshTokenExpiresAt) - NOW.getTime()) / 3_600_000;
      expect(hours).toBe(12);
      adminToken = totp.json.data.accessToken;

      const [enrolled] = await e2e.db.sql<{ totp_secret: string }[]>`
        SELECT totp_secret FROM staff_users WHERE id = ${admin.id}`;
      expect(enrolled?.totp_secret).toMatch(/^v1\./);
      expect(enrolled?.totp_secret).not.toContain(secret);
      const me = await e2e.call('GET', '/admin/me', { token: adminToken });
      expect(me.json.data.email).toBe('root@clickco.test');
      expect((await audit('staff.totp_enrolled')).map((r) => r.actor_id)).toEqual([admin.id]);
      const [signedIn] = await audit('staff.login');
      expect(signedIn).toMatchObject({ actor_kind: 'STAFF', actor_id: admin.id });
      expect(signedIn?.request_id).toBeTruthy();
    });

    it('a used code is refused, and five wrong codes burn the challenge', async () => {
      const secret = secrets.get('root@clickco.test') as string;
      const used = codeFor(e2e, secret);
      const login = await e2e.call('POST', '/admin/auth/login', {
        body: { email: 'root@clickco.test', password: admin.password },
      });
      expect(login.json.data).toMatchObject({ step: 'TOTP', enrolment: null });
      const challengeId = login.json.data.challengeId;
      const replay = await e2e.call('POST', '/admin/auth/totp', {
        body: { challengeId, code: used },
      });
      expect(replay.status).toBe(401);
      expect(replay.json.error.code).toBe('TOTP_INVALID');
      const wrong = used === '000000' ? '111111' : '000000';
      for (let i = 0; i < 3; i++) {
        const r = await e2e.call('POST', '/admin/auth/totp', {
          body: { challengeId, code: wrong },
        });
        expect(r.json.error.code).toBe('TOTP_INVALID');
      }
      const fifth = await e2e.call('POST', '/admin/auth/totp', {
        body: { challengeId, code: wrong },
      });
      expect(fifth.json.error.code).toBe('CHALLENGE_INVALID');
      e2e.advance(31_000);
      const late = await e2e.call('POST', '/admin/auth/totp', {
        body: { challengeId, code: codeFor(e2e, secret) },
      });
      expect(late.json.error.code).toBe('CHALLENGE_INVALID');
      const reasons = (await audit('staff.login_failed')).map((r) => r.after_state?.reason);
      expect(reasons).toEqual(['TOTP_REUSED', 'BAD_TOTP', 'BAD_TOTP', 'BAD_TOTP', 'BAD_TOTP']);
    });

    it('unknown email and wrong password get the same 401, both audited with the email', async () => {
      const unknown = await e2e.call('POST', '/admin/auth/login', {
        body: { email: 'nobody@clickco.test', password: 'whatever-password' },
      });
      const wrong = await e2e.call('POST', '/admin/auth/login', {
        body: { email: 'root@clickco.test', password: 'not-the-password' },
      });
      expect([unknown.status, wrong.status]).toEqual([401, 401]);
      expect(unknown.json.error).toEqual(wrong.json.error);
      const rows = (await audit('staff.login_failed')).slice(-2);
      expect(rows.map((r) => [r.actor_email, r.entity_id])).toEqual([
        ['nobody@clickco.test', null],
        ['root@clickco.test', admin.id],
      ]);
    });

    it('5 failed passwords lock the email for 15 minutes (429), even with the right one', async () => {
      const victim = await bootstrapStaff(e2e, 'locked@clickco.test', 'SUPPORT');
      for (let i = 0; i < 5; i++) {
        const r = await e2e.call('POST', '/admin/auth/login', {
          body: { email: 'locked@clickco.test', password: `wrong-${i}` },
        });
        expect(r.status).toBe(401);
      }
      const locked = await e2e.call('POST', '/admin/auth/login', {
        body: { email: 'locked@clickco.test', password: victim.password },
      });
      expect(locked.status).toBe(429);
      expect(locked.json.error.code).toBe('RATE_LIMITED');
      const reasons = (await audit('staff.login_failed')).map((r) => r.after_state?.reason);
      expect(reasons.at(-1)).toBe('LOCKED');
    });

    it('10 wrong codes on one account stop new challenges, whatever the password', async () => {
      const brute = await bootstrapStaff(e2e, 'brute@clickco.test', 'SUPPORT');
      await signIn(e2e, secrets, 'brute@clickco.test', brute.password);
      for (let round = 0; round < 2; round++) {
        e2e.advance(31_000);
        const login = await e2e.call('POST', '/admin/auth/login', {
          body: { email: 'brute@clickco.test', password: brute.password },
        });
        const right = codeFor(e2e, secrets.get('brute@clickco.test') as string);
        const wrong = right === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++) {
          await e2e.call('POST', '/admin/auth/totp', {
            body: { challengeId: login.json.data.challengeId, code: wrong },
          });
        }
      }
      const blocked = await e2e.call('POST', '/admin/auth/login', {
        body: { email: 'brute@clickco.test', password: brute.password },
      });
      expect([blocked.status, blocked.json.error.code]).toEqual([429, 'RATE_LIMITED']);
      const reasons = (await audit('staff.login_failed')).map((r) => r.after_state?.reason);
      expect(reasons.at(-1)).toBe('LOCKED_TOTP');
    });

    it('refresh rotates within the 12-hour session; logout ends it', async () => {
      const session = await signIn(e2e, secrets, 'root@clickco.test', admin.password);
      const refreshed = await e2e.call('POST', '/admin/auth/refresh', {
        body: { refreshToken: session.refreshToken },
      });
      expect(refreshed.status).toBe(200);
      expect(refreshed.json.data.refreshTokenExpiresAt).toBe(session.refreshTokenExpiresAt);
      const out = await e2e.call('POST', '/admin/auth/logout', {
        body: { refreshToken: refreshed.json.data.refreshToken },
      });
      expect(out.json.data).toEqual({ loggedOut: true });
      const again = await e2e.call('POST', '/admin/auth/refresh', {
        body: { refreshToken: refreshed.json.data.refreshToken },
      });
      expect(again.status).toBe(401);
      expect((await audit('staff.logout')).map((r) => r.actor_id)).toContain(admin.id);
    });

    it('a staff session left unused for an hour cannot be refreshed (closed tab, lifted token)', async () => {
      const session = await signIn(e2e, secrets, 'root@clickco.test', admin.password);
      e2e.advance(TOKEN_POLICY.staffIdleMs + 1_000);
      const stale = await e2e.call('POST', '/admin/auth/refresh', {
        body: { refreshToken: session.refreshToken },
      });
      expect(stale.status).toBe(401);
      // Expiry, not theft: other sessions of the same person are untouched.
      const fresh = await signIn(e2e, secrets, 'root@clickco.test', admin.password);
      const ok = await e2e.call('POST', '/admin/auth/refresh', {
        body: { refreshToken: fresh.refreshToken },
      });
      expect(ok.status).toBe(200);
    });

    it('client and photographer sessions cannot use /admin', async () => {
      const [user] = await e2e.db.sql<{ id: string }[]>`
        INSERT INTO users (phone_e164) VALUES ('+919700089001') RETURNING id`;
      const t = await e2e.get(TokenService).issue({ kind: 'USER', id: user?.id as string }, null);
      const res = await e2e.call('GET', '/admin/me', { token: t.accessToken });
      expect(res.status).toBe(403);
      expect((await e2e.call('GET', '/admin/me')).status).toBe(401);
    });
  });

  describe('staff management (SUPER_ADMIN, D5)', () => {
    const created: Record<string, { id: string; password: string; grants: Json[] }> = {};
    const create = async (key: string, body: Json) => {
      const res = await post('/admin/staff', adminToken, body);
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      created[key] = {
        id: res.json.data.staff.id,
        password: res.json.data.temporaryPassword,
        grants: res.json.data.staff.grants,
      };
      return res;
    };

    it('creates accounts with a temporary password shown once', async () => {
      adminToken = await staffToken(e2e, admin.id);
      const res = await create('cm', {
        email: 'cm.surat@clickco.test',
        fullName: 'Surat Manager',
        grants: [{ role: 'CITY_MANAGER', cityId: surat }],
      });
      expect(res.json.data.temporaryPassword.length).toBeGreaterThanOrEqual(16);
      expect(res.json.data.staff).toMatchObject({
        isActive: true,
        totpEnrolled: false,
        grants: [{ role: 'CITY_MANAGER', cityId: surat, cityName: 'Surat' }],
      });
      await create('finance', {
        email: 'finance@clickco.test',
        fullName: 'Finance Person',
        grants: [{ role: 'FINANCE', cityId: null }],
      });
      const dup = await post('/admin/staff', adminToken, {
        email: 'CM.Surat@clickco.test',
        fullName: 'Again',
        grants: [{ role: 'OPS_AGENT', cityId: null }],
      });
      expect(dup.status).toBe(409);
      const unscoped = await post('/admin/staff', adminToken, {
        email: 'cm2@clickco.test',
        fullName: 'No City',
        grants: [{ role: 'CITY_MANAGER', cityId: null }],
      });
      expect(unscoped.status).toBe(400);
      const scopedAdmin = await post('/admin/staff', adminToken, {
        email: 'sa2@clickco.test',
        fullName: 'City Admin',
        grants: [{ role: 'SUPER_ADMIN', cityId: surat }],
      });
      expect([scopedAdmin.status, scopedAdmin.json.error.code]).toEqual([
        422,
        'SUPER_ADMIN_IS_GLOBAL',
      ]);
      const [row] = await audit('staff.create').then((r) =>
        r.filter((a) => a.actor_id === admin.id),
      );
      expect(row).toMatchObject({ actor_kind: 'STAFF', entity_id: created.cm?.id });
      const stored = await e2e.db.sql`
        SELECT 1 FROM idempotency_keys WHERE response_body::text LIKE ${`%${created.cm?.password}%`}`;
      expect(stored).toHaveLength(0);
    });

    it('only SUPER_ADMIN manages staff', async () => {
      const t = await staffToken(e2e, created.finance?.id as string);
      expect((await e2e.call('GET', '/admin/staff', { token: t })).status).toBe(403);
      const res = await post('/admin/staff', t, {
        email: 'x@clickco.test',
        fullName: 'X',
        grants: [{ role: 'SUPER_ADMIN', cityId: null }],
      });
      expect(res.status).toBe(403);
    });

    it('lists staff with a keyset cursor', async () => {
      const emails: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await e2e.call(
          'GET',
          `/admin/staff?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
          { token: adminToken },
        );
        expect(page.json.data.items.length).toBeLessThanOrEqual(2);
        emails.push(...page.json.data.items.map((s: Json) => s.email as string));
        cursor = page.json.data.nextCursor;
      } while (cursor);
      expect(new Set(emails).size).toBe(emails.length);
      expect(emails).toEqual([...emails].sort());
      expect(emails).toEqual(expect.arrayContaining(['root@clickco.test', 'finance@clickco.test']));
      const forged = await e2e.call('GET', '/admin/staff?cursor=eyJlIjoieCIsImkiOiJ4In0', {
        token: adminToken,
      });
      expect([forged.status, forged.json.error.code]).toEqual([400, 'INVALID_CURSOR']);
    });

    it('grants and revokes roles; a SUPER_ADMIN keeps their own role and account', async () => {
      const id = created.finance?.id as string;
      const granted = await post(`/admin/staff/${id}/grants`, adminToken, {
        role: 'READ_ONLY',
        cityId: null,
      });
      expect(granted.status).toBe(200);
      const grant = granted.json.data.grants.find((g: Json) => g.role === 'READ_ONLY');
      expect(grant.id).toBeTruthy();
      const twice = await post(`/admin/staff/${id}/grants`, adminToken, {
        role: 'READ_ONLY',
        cityId: null,
      });
      expect(twice.status).toBe(409);
      const revoked = await post(`/admin/staff/${id}/grants/${grant.id}/revoke`, adminToken);
      expect(revoked.json.data.grants.map((g: Json) => g.role)).toEqual(['FINANCE']);

      const own = (await e2e.call('GET', '/admin/me', { token: adminToken })).json.data.grants[0];
      const drop = await post(`/admin/staff/${admin.id}/grants/${own.id}/revoke`, adminToken);
      expect(drop.json.error.code).toBe('CANNOT_DROP_OWN_SUPER_ADMIN');
      const self = await post(`/admin/staff/${admin.id}/deactivate`, adminToken);
      expect(self.json.error.code).toBe('CANNOT_DEACTIVATE_SELF');
      expect((await audit('staff.grant')).length).toBe(1);
      expect((await audit('staff.revoke_grant')).length).toBe(1);
    });

    it('deactivation ends every session at once, and the sign-in answer stays the generic 401', async () => {
      const session = await signIn(
        e2e,
        secrets,
        'finance@clickco.test',
        created.finance?.password as string,
      );
      expect((await e2e.call('GET', '/admin/me', { token: session.accessToken })).status).toBe(200);
      const res = await post(`/admin/staff/${created.finance?.id}/deactivate`, adminToken);
      expect(res.json.data.isActive).toBe(false);
      const me = await e2e.call('GET', '/admin/me', { token: session.accessToken });
      expect([me.status, me.json.error.code]).toEqual([401, 'ACCOUNT_INACTIVE']);
      const refresh = await e2e.call('POST', '/admin/auth/refresh', {
        body: { refreshToken: session.refreshToken },
      });
      expect(refresh.status).toBe(401);
      const login = await e2e.call('POST', '/admin/auth/login', {
        body: { email: 'finance@clickco.test', password: created.finance?.password },
      });
      expect([login.status, login.json.error.code]).toEqual([401, 'INVALID_CREDENTIALS']);
    });

    it('resetting TOTP ends sessions and makes the next sign-in enrol again', async () => {
      const email = 'cm.surat@clickco.test';
      const session = await signIn(e2e, secrets, email, created.cm?.password as string);
      const res = await post(`/admin/staff/${created.cm?.id}/reset-totp`, adminToken);
      expect(res.json.data.totpEnrolled).toBe(false);
      const refresh = await e2e.call('POST', '/admin/auth/refresh', {
        body: { refreshToken: session.refreshToken },
      });
      expect(refresh.status).toBe(401);
      e2e.advance(31_000);
      const login = await e2e.call('POST', '/admin/auth/login', {
        body: { email, password: created.cm?.password },
      });
      expect(login.json.data.step).toBe('ENROL_TOTP');
      expect((await audit('staff.reset_totp')).map((r) => r.entity_id)).toEqual([created.cm?.id]);
    });

    it('audit_logs refuses UPDATE and DELETE', async () => {
      await expect(e2e.db.sql`UPDATE audit_logs SET action = 'x'`).rejects.toThrow(/append-only/);
      await expect(e2e.db.sql`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
    });
  });
});
