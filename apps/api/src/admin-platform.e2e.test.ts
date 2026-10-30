import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StaffRole } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OverviewRegistry } from './modules/admin/overview/overview.registry';
import { TokenService } from './modules/auth/token.service';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { bookAndPay, insertClient } from './test-support/onsite-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import {
  bootstrapStaff,
  cityIdOf,
  codeFor,
  currentPassword,
  signIn,
  staffToken,
} from './test-support/staff-fixtures';

/** 30 Oct 2026, 3:00 pm IST. */
const NOW = new Date('2026-10-30T09:30:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Noon IST on NOW's day. */
const TODAY_NOON = new Date('2026-10-30T06:30:00.000Z');
const REPO = join(__dirname, '../../..');

/**
 * ADR-0026 stream E end to end: "Today" (GET /admin/overview, D8) role- and city-scoped, with the
 * source registry Sprint 10 desks plug into; and the staff password lifecycle (D7): temporary
 * passwords expire after 72 h, the first sign-in with one sets a new password, a SUPER_ADMIN
 * reset, and a signed-in password change.
 */
describe.runIf(TEST_DATABASE_URL)('the staff platform (Today, passwords)', () => {
  let e2e: E2eApp;
  const staff = {} as Record<
    'admin' | 'ops' | 'finance' | 'readOnly' | 'cmSurat' | 'cmMumbai',
    { id: string; password: string }
  >;
  const secrets = new Map<string, string>();
  let qaBooking: string;
  let onSiteBooking: string;

  const as = (who: keyof typeof staff) => staffToken(e2e, staff[who].id);
  const overview = async (who: keyof typeof staff) => {
    const res = await e2e.call('GET', '/admin/overview', { token: await as(who) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return res.json.data as Json;
  };
  /** Sprint 9's sources (other streams register their own; they are not asserted here). */
  const S9 = new Set([
    'bookings.today',
    'bookings.on_site',
    'bookings.delivery_due',
    'qa.waiting',
    'incidents.to_confirm',
    'dispatch.unfilled',
    'alerts.last_day',
    'test.payouts_due',
  ]);
  const S9_DESKS = new Set(['qa', 'incidents', 'dispatch', 'alerts', 'breaches']);
  const tiles = (o: Json) =>
    Object.fromEntries(
      (o.tiles as Json[])
        .filter((t) => S9.has(t.key as string))
        .map((t) => [t.key as string, t.value as number]),
    );
  const needs = (o: Json) =>
    (o.needsYou as Json[]).map((n) => n.desk as string).filter((d) => S9_DESKS.has(d));
  const audit = (action: string) =>
    e2e.db.sql<
      { actor_id: string | null; entity_id: string; before_state: Json; after_state: Json }[]
    >`
      SELECT actor_id, entity_id, before_state, after_state FROM audit_logs
      WHERE action = ${action} ORDER BY id`;
  const passwordState = async (id: string) => {
    const [row] = await e2e.db.sql<
      {
        must_change_password: boolean;
        temp_password_expires_at: Date | null;
        password_changed_at: Date | null;
      }[]
    >`SELECT must_change_password, temp_password_expires_at, password_changed_at
      FROM staff_users WHERE id = ${id}`;
    return row;
  };
  const login = (email: string, password: string) =>
    e2e.call('POST', '/admin/auth/login', { body: { email, password } });

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    const surat = await cityIdOf(e2e, 'Surat');
    const mumbai = await cityIdOf(e2e, 'Mumbai');
    const make = async (key: keyof typeof staff, role: StaffRole, cityId: string | null = null) => {
      staff[key] = await bootstrapStaff(e2e, `${key}@clickco.test`, role, cityId);
    };
    await make('admin', 'SUPER_ADMIN');
    await make('ops', 'OPS_AGENT');
    await make('finance', 'FINANCE');
    await make('readOnly', 'READ_ONLY');
    await make('cmSurat', 'CITY_MANAGER', surat);
    await make('cmMumbai', 'CITY_MANAGER', mumbai);

    // Three Surat bookings: one still dispatching (in two days), and two of today's shoots —
    // one on site, one waiting in QA — set directly (the flows are covered by their own suites).
    const start = new Date(NOW.getTime() + 2 * DAY);
    await bookAndPay(e2e, await insertClient(e2e, '+919700089101'), start);
    qaBooking = (await bookAndPay(e2e, await insertClient(e2e, '+919700089102'), start)).id;
    onSiteBooking = (await bookAndPay(e2e, await insertClient(e2e, '+919700089103'), start)).id;
    await e2e.db.sql`
      UPDATE bookings SET status = 'QA', scheduled_start = ${TODAY_NOON} WHERE id = ${qaBooking}`;
    await e2e.db.sql`
      UPDATE bookings SET status = 'IN_PROGRESS', scheduled_start = ${TODAY_NOON}
      WHERE id = ${onSiteBooking}`;
    // Delivery promises: one inside the next 24 h, one after it.
    await e2e.db.sql`
      INSERT INTO sla_clocks (booking_id, kind, anchor_at, due_at) VALUES
        (${qaBooking}, 'DELIVERY_DUE', ${NOW}, ${new Date(NOW.getTime() + 5 * HOUR)}),
        (${onSiteBooking}, 'DELIVERY_DUE', ${NOW}, ${new Date(NOW.getTime() + 30 * HOUR)})`;
    // Alerts: one an hour ago (counts), one two days ago (listed, but not in the last 24 h).
    const alert = (bookingId: string, at: Date) => e2e.db.sql`
      INSERT INTO domain_events (event_type, aggregate_kind, aggregate_id, payload, occurred_at,
                                 published_at)
      VALUES ('ops.alert', 'booking', ${bookingId},
              ${e2e.db.sql.json({ severity: 'HIGH', source_event_type: 'sla.breached' })},
              ${at}, ${at})`;
    await alert(qaBooking, new Date(NOW.getTime() - HOUR));
    await alert(onSiteBooking, new Date(NOW.getTime() - 2 * DAY));
  }, 180_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('Today — GET /admin/overview (D8)', () => {
    it('gives an ops agent every floor number, its "Needs you" cards and the newest alerts', async () => {
      // The booking flows raise alerts of their own: count against the alert desk itself.
      const feed = await e2e.call('GET', '/admin/alerts?limit=100', { token: await as('ops') });
      const items = feed.json.data.items as Json[];
      const lastDay = items.filter(
        (a) => Date.parse(a.occurredAt as string) >= NOW.getTime() - DAY,
      ).length;
      expect(items.some((a) => a.bookingId === onSiteBooking)).toBe(true);
      expect(lastDay).toBe(items.length - 1); // the two-day-old one is listed, not counted

      const o = await overview('ops');
      expect(tiles(o)).toEqual({
        'bookings.today': 2,
        'bookings.on_site': 1,
        'bookings.delivery_due': 1,
        'qa.waiting': 1,
        'incidents.to_confirm': 0,
        'dispatch.unfilled': 1,
        'alerts.last_day': lastDay,
      });
      expect((o.tiles as Json[]).map((t) => t.key).filter((k) => S9.has(k))).toEqual([
        'bookings.today',
        'bookings.on_site',
        'bookings.delivery_due',
        'qa.waiting',
        'incidents.to_confirm',
        'dispatch.unfilled',
        'alerts.last_day',
      ]);
      const qa = (o.tiles as Json[]).find((t) => t.key === 'qa.waiting');
      expect(qa).toMatchObject({ desk: 'qa', label: 'Waiting for QA', tone: 'attention' });
      expect((o.tiles as Json[]).find((t) => t.key === 'incidents.to_confirm')?.tone).toBe(
        'neutral',
      );
      // All "attention": the larger count first (alerts ≥ 1), then by desk name.
      expect(needs(o)).toEqual(['alerts', 'dispatch', 'qa']);
      expect((o.needsYou as Json[]).find((n) => n.desk === 'qa')).toEqual({
        desk: 'qa',
        count: 1,
        capped: false,
        title: 'Waiting for QA',
        line: '1 shoot is waiting for a quality check.',
        action: 'Start checking',
        tone: 'attention',
      });
      expect(o.latestAlerts).toEqual(items.slice(0, 5));
      expect((o.latestAlerts as Json[]).length).toBe(Math.min(items.length, 5));
      expect(o.incomplete).toBe(false);
    });

    it('shows finance only the desks finance opens', async () => {
      const o = await overview('finance');
      expect(Object.keys(tiles(o))).toEqual([
        'bookings.today',
        'bookings.on_site',
        'bookings.delivery_due',
        'alerts.last_day',
      ]);
      expect(needs(o)).toEqual(['alerts']);
      expect(tiles(o)['alerts.last_day']).toBeGreaterThanOrEqual(1);
    });

    it('shows read-only dispatch but not QA or incidents', async () => {
      const keys = Object.keys(tiles(await overview('readOnly')));
      expect(keys).toContain('dispatch.unfilled');
      expect(keys).not.toContain('qa.waiting');
      expect(keys).not.toContain('incidents.to_confirm');
    });

    it('counts within the caller’s cities only', async () => {
      const surat = await overview('cmSurat');
      expect(tiles(surat)['qa.waiting']).toBe(1);
      const mumbai = await overview('cmMumbai');
      expect(tiles(mumbai)).toMatchObject({
        'bookings.today': 0,
        'qa.waiting': 0,
        'dispatch.unfilled': 0,
        'alerts.last_day': 0,
      });
      expect(needs(mumbai)).toEqual([]);
      expect(mumbai.latestAlerts).toEqual([]);
    });

    it('is for staff only', async () => {
      const [user] = await e2e.db.sql<{ id: string }[]>`
        INSERT INTO users (phone_e164) VALUES ('+919700089199') RETURNING id`;
      const t = await e2e.get(TokenService).issue({ kind: 'USER', id: user?.id as string }, null);
      expect((await e2e.call('GET', '/admin/overview', { token: t.accessToken })).status).toBe(403);
      expect((await e2e.call('GET', '/admin/overview')).status).toBe(401);
    });

    it('takes a Sprint 10 count with one registration, and survives a broken one', async () => {
      const registry = e2e.get(OverviewRegistry);
      registry.register({
        key: 'test.payouts_due',
        desk: 'payouts',
        count: async () => 4,
        tile: { label: 'Payouts due', hint: 'Test source', order: 15 },
      });
      registry.register({
        key: 'test.broken',
        desk: 'bookings',
        count: async () => {
          throw new Error('source down');
        },
        tile: { label: 'Broken', hint: 'Test source', order: 99 },
      });
      expect(() =>
        registry.register({
          key: 'test.payouts_due',
          desk: 'payouts',
          count: async () => 1,
          tile: { label: 'Again', hint: '', order: 1 },
        }),
      ).toThrow(/registered twice/);
      const finance = await overview('finance');
      expect(Object.keys(tiles(finance)).slice(0, 2)).toEqual([
        'bookings.today',
        'test.payouts_due',
      ]);
      expect(tiles(finance)['test.payouts_due']).toBe(4);
      expect(finance.incomplete).toBe(true);
      // Payouts is finance's desk: an ops agent is not even asked.
      expect(Object.keys(tiles(await overview('ops')))).not.toContain('test.payouts_due');
    });
  });

  describe('first sign-in with a temporary password (D7)', () => {
    it('must choose a new password alongside the code; the policy is checked first', async () => {
      const temp = await bootstrapStaff(e2e, 'new.joiner@clickco.test', 'SUPPORT', null, {
        temporary: true,
      });
      const state = await passwordState(temp.id);
      expect(state?.must_change_password).toBe(true);
      expect(state?.temp_password_expires_at?.getTime()).toBe(NOW.getTime() + 72 * HOUR);

      e2e.advance(31_000);
      const first = await login('new.joiner@clickco.test', temp.password);
      expect(first.json.data).toMatchObject({ step: 'ENROL_TOTP', mustChangePassword: true });
      const { challengeId } = first.json.data;
      const secret = first.json.data.enrolment.secret as string;
      const totp = (body: Json) =>
        e2e.call('POST', '/admin/auth/totp', {
          body: { challengeId, code: codeFor(e2e, secret), ...body },
        });

      const missing = await totp({});
      expect([missing.status, missing.json.error.code]).toEqual([422, 'PASSWORD_CHANGE_REQUIRED']);
      const asEmail = await totp({ newPassword: 'New.Joiner@clickco.test' });
      expect([asEmail.status, asEmail.json.error.message]).toEqual([
        422,
        'Don’t use your email as your password',
      ]);
      const short = await totp({ newPassword: 'too-short' });
      expect(short.status).toBe(400);
      // Reusing the temporary password is only checked (one scrypt) after a right code; the
      // challenge survives it, and the next code step finishes.
      const same = await totp({ newPassword: temp.password });
      expect(same.json.error).toMatchObject({
        code: 'PASSWORD_REJECTED',
        message: 'Choose a password different from the current one',
      });
      e2e.advance(31_000);

      const done = await totp({ newPassword: 'monsoon-ferry-lantern' });
      expect(done.status, JSON.stringify(done.json)).toBe(200);
      expect(done.json.data.staff.email).toBe('new.joiner@clickco.test');
      const after = await passwordState(temp.id);
      expect(after).toMatchObject({ must_change_password: false, temp_password_expires_at: null });
      expect(after?.password_changed_at?.getTime()).toBe(e2e.now().getTime());
      const [changed] = (await audit('staff.password_changed')).slice(-1);
      expect(changed).toMatchObject({ actor_id: temp.id, entity_id: temp.id });
      expect(changed?.after_state).toEqual({ must_change_password: false, via: 'first_sign_in' });
      expect(JSON.stringify(changed)).not.toContain('monsoon');

      expect((await login('new.joiner@clickco.test', temp.password)).status).toBe(401);
      e2e.advance(31_000);
      const again = await login('new.joiner@clickco.test', 'monsoon-ferry-lantern');
      expect(again.json.data).toMatchObject({ step: 'TOTP', mustChangePassword: false });
    });
  });

  describe('a SUPER_ADMIN resets a password (D7)', () => {
    it('issues a 72-hour temporary password once, ends every session, and audits no secret', async () => {
      const target = await bootstrapStaff(e2e, 'forgetful@clickco.test', 'OPS_AGENT');
      const session = await signIn(e2e, secrets, 'forgetful@clickco.test', target.password);
      // A sign-in under way when the reset lands is void.
      e2e.advance(31_000);
      const pending = await login('forgetful@clickco.test', target.password);

      const res = await e2e.call('POST', `/admin/staff/${target.id}/reset-password`, {
        token: await as('admin'),
      });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const { temporaryPassword, expiresAt } = res.json.data;
      expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);
      expect(Date.parse(expiresAt)).toBe(e2e.now().getTime() + 72 * HOUR);
      expect(res.json.data.staff).toMatchObject({
        id: target.id,
        totpEnrolled: true,
        temporaryPasswordExpiresAt: expiresAt,
      });
      expect(res.headers.get('cache-control')).toBe('no-store');

      const refresh = await e2e.call('POST', '/admin/auth/refresh', {
        body: { refreshToken: session.refreshToken },
      });
      expect(refresh.status).toBe(401);
      // The access token dies at once too (session epoch), not when its 15 minutes run out.
      const meAfter = await e2e.call('GET', '/admin/me', { token: session.accessToken });
      expect([meAfter.status, meAfter.json.error.code]).toEqual([401, 'SESSION_REVOKED']);
      const stale = await e2e.call('POST', '/admin/auth/totp', {
        body: {
          challengeId: pending.json.data.challengeId,
          code: codeFor(e2e, secrets.get('forgetful@clickco.test') as string),
        },
      });
      expect(stale.json.error.code).toBe('CHALLENGE_INVALID');
      expect((await login('forgetful@clickco.test', target.password)).status).toBe(401);

      e2e.advance(31_000);
      const fresh = await login('forgetful@clickco.test', temporaryPassword);
      expect(fresh.json.data).toMatchObject({ step: 'TOTP', mustChangePassword: true });

      const [row] = (await audit('staff.reset_password')).slice(-1);
      expect(row).toMatchObject({ actor_id: staff.admin.id, entity_id: target.id });
      expect(row?.after_state).toEqual({
        must_change_password: true,
        temp_password_expires_at: expiresAt,
        sessions_revoked: true,
      });
      expect(JSON.stringify(row)).not.toContain(temporaryPassword);
      const stored = await e2e.db.sql`
        SELECT 1 FROM idempotency_keys WHERE response_body::text LIKE ${`%${temporaryPassword}%`}`;
      expect(stored).toHaveLength(0);
    });

    it('is SUPER_ADMIN only, never one’s own, and never a deactivated account', async () => {
      const someone = await bootstrapStaff(e2e, 'someone@clickco.test', 'SUPPORT');
      const reset = async (who: keyof typeof staff, id: string) =>
        e2e.call('POST', `/admin/staff/${id}/reset-password`, { token: await as(who) });
      expect((await reset('ops', someone.id)).status).toBe(403);
      const own = await reset('admin', staff.admin.id);
      expect([own.status, own.json.error.code]).toEqual([409, 'CANNOT_RESET_OWN_PASSWORD']);
      await e2e.call('POST', `/admin/staff/${someone.id}/deactivate`, {
        token: await as('admin'),
        idempotencyKey: 'platform-deactivate-someone-0001',
      });
      const inactive = await reset('admin', someone.id);
      expect([inactive.status, inactive.json.error.code]).toEqual([409, 'STAFF_INACTIVE']);
    });
  });

  describe('changing one’s own password (D7)', () => {
    it('needs the current password, a policy-safe new one and a fresh code', async () => {
      const me = await bootstrapStaff(e2e, 'changer@clickco.test', 'QUALITY_MANAGER');
      const session = await signIn(e2e, secrets, 'changer@clickco.test', me.password);
      const secret = secrets.get('changer@clickco.test') as string;
      const change = (body: Json) =>
        e2e.call('POST', '/admin/me/password', { token: session.accessToken, body });

      e2e.advance(31_000);
      const wrong = await change({
        currentPassword: 'not-my-password',
        newPassword: 'harbour-cinnamon-kite',
        code: codeFor(e2e, secret),
      });
      // 422, never 401: a 401 would end the session in the panel.
      expect([wrong.status, wrong.json.error.code]).toEqual([422, 'CURRENT_PASSWORD_WRONG']);
      const same = await change({
        currentPassword: me.password,
        newPassword: me.password,
        code: codeFor(e2e, secret),
      });
      expect(same.json.error.code).toBe('PASSWORD_REJECTED');
      const badCode = await change({
        currentPassword: me.password,
        newPassword: 'harbour-cinnamon-kite',
        code: codeFor(e2e, secret) === '000000' ? '111111' : '000000',
      });
      expect([badCode.status, badCode.json.error.code]).toEqual([422, 'TOTP_INVALID']);

      const ok = await change({
        currentPassword: me.password,
        newPassword: 'harbour-cinnamon-kite',
        code: codeFor(e2e, secret),
      });
      expect(ok.status, JSON.stringify(ok.json)).toBe(200);
      expect(ok.json.data.accessToken).toBeTruthy();
      const oldRefresh = await e2e.call('POST', '/admin/auth/refresh', {
        body: { refreshToken: session.refreshToken },
      });
      expect(oldRefresh.status).toBe(401);
      const oldAccess = await e2e.call('GET', '/admin/me', { token: session.accessToken });
      expect(oldAccess.json.error.code).toBe('SESSION_REVOKED');
      const me2 = await e2e.call('GET', '/admin/me', { token: ok.json.data.accessToken });
      expect(me2.json.data.email).toBe('changer@clickco.test');
      const newRefresh = await e2e.call('POST', '/admin/auth/refresh', {
        body: { refreshToken: ok.json.data.refreshToken },
      });
      expect(newRefresh.status).toBe(200);

      expect((await login('changer@clickco.test', me.password)).status).toBe(401);
      e2e.advance(31_000);
      expect((await login('changer@clickco.test', 'harbour-cinnamon-kite')).status).toBe(200);
      const [row] = (await audit('staff.password_changed')).slice(-1);
      expect(row?.after_state).toEqual({
        must_change_password: false,
        via: 'self_service',
        sessions_revoked: true,
      });
      const failures = (await audit('staff.password_change_failed')).map(
        (r) => r.after_state?.reason,
      );
      expect(failures).toEqual(['BAD_PASSWORD', 'BAD_TOTP']);
    });
  });

  describe('temporary passwords expire after 72 hours (D7)', () => {
    it('works at 71 h, is refused with a clear message after 72 h', async () => {
      const late = await bootstrapStaff(e2e, 'late.starter@clickco.test', 'SUPPORT', null, {
        temporary: true,
      });
      e2e.advance(71 * HOUR);
      const inTime = await login('late.starter@clickco.test', late.password);
      expect(inTime.json.data?.mustChangePassword).toBe(true);
      e2e.advance(HOUR);
      const expired = await login('late.starter@clickco.test', late.password);
      expect([expired.status, expired.json.error.code]).toEqual([
        401,
        'TEMPORARY_PASSWORD_EXPIRED',
      ]);
      expect(expired.json.error.message).toMatch(/expired.*Ask a super admin to reset it/);
      // A wrong password still gets the generic answer: expiry is only told to its holder.
      const wrong = await login('late.starter@clickco.test', 'not-the-password');
      expect(wrong.json.error.code).toBe('INVALID_CREDENTIALS');
      // The code step of a challenge earned before expiry is refused too.
      const challenge = inTime.json.data;
      const code = await e2e.call('POST', '/admin/auth/totp', {
        body: {
          challengeId: challenge.challengeId,
          code: '123456',
          newPassword: 'lotus-pepper-railway',
        },
      });
      expect(code.status).toBe(401);
      const reasons = (await audit('staff.login_failed')).map((r) => r.after_state?.reason);
      expect(reasons).toContain('TEMP_PASSWORD_EXPIRED');
      // A reset brings the account back.
      const reset = await e2e.call('POST', `/admin/staff/${late.id}/reset-password`, {
        token: await as('admin'),
      });
      const back = await login('late.starter@clickco.test', reset.json.data.temporaryPassword);
      expect(back.json.data?.mustChangePassword).toBe(true);
      expect(currentPassword(secrets, 'late.starter@clickco.test', 'x')).toBe('x');
    });
  });

  it('migration 0007 is byte-identical to its schema addendum', () => {
    expect(
      readFileSync(join(REPO, 'apps/api/src/infra/db/migrations/0007_staff_passwords.sql'), 'utf8'),
    ).toBe(readFileSync(join(REPO, 'docs/schema-addenda/0007-staff-passwords.sql'), 'utf8'));
  });
});
