import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingsService } from './modules/bookings/bookings.service';
import { walkTo } from './modules/media/__tests__/media-fixtures';
import { RefundsService } from './modules/refunds/refunds.service';
import { ReviewsService } from './modules/refunds/reviews.service';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import {
  acceptOffer,
  bookAndPay,
  idemKey,
  insertClient,
  tokenFor,
} from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff } from './test-support/staff-fixtures';

/** Monday 7 Dec 2026, 10:00 IST. */
const NOW = new Date('2026-12-07T04:30:00.000Z');
const DAY = 86_400_000;
const PHONE = '+919999377001';
const PUSH_TOKEN = 'ExponentPushToken[deletion-e2e-0001]';

interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: Json;
}

/**
 * ADR-0030 — a client deletes their own account (Apple 5.1.1(v), DPDP s.12): refused while a
 * paid booking is unfinished or money is still being settled, confirmed with a fresh OTP to the
 * account's phone, idempotent. Personal fields are anonymised; invoices, payments, the ledger
 * and the audit log stay, still pointing at the same (now anonymous) account. Every session ends,
 * and the same number later signs up as a brand-new account.
 */
describe.runIf(TEST_DATABASE_URL)('client account deletion', () => {
  let e2e: E2eApp;
  let session: Session;
  let userId: string;
  let pro: string;
  let qm: string;
  let finance: string;
  let paid: Json;
  let assignmentId: string;
  let unpaidId: string;
  let deletedAt: string;
  let confirmBody: { challengeId: string; code: string };
  const confirmKey = idemKey('delete-account');

  const signIn = async (phone: string): Promise<Session> => {
    const req = await e2e.call('POST', '/auth/otp/request', { body: { phone } });
    expect(req.status).toBe(200);
    await e2e.runDueJobs();
    const res = await e2e.call('POST', '/auth/otp/verify', {
      body: {
        challengeId: req.json.data.challengeId,
        phone,
        code: e2e.sms.last.get(phone),
        deviceId: 'device-e2e-0001',
      },
    });
    expect(res.status).toBe(200);
    return res.json.data as Session;
  };
  const me = (path: string, method = 'GET', body?: unknown, key?: string) =>
    e2e.call(method, `/me${path}`, {
      token: session.accessToken,
      ...(body === undefined ? {} : { body }),
      ...(key ? { idempotencyKey: key } : {}),
    });
  /** A fresh deletion code, sent to the account's phone through the OTP SMS job. */
  const requestCode = async (): Promise<{ challengeId: string; code: string }> => {
    e2e.advance(31_000); // past the per-phone resend cooldown
    const res = await me('/deletion/request', 'POST');
    expect(res.status).toBe(200);
    await e2e.runDueJobs();
    return { challengeId: res.json.data.challengeId, code: e2e.sms.last.get(PHONE) ?? '' };
  };
  const userRow = async (id: string) =>
    (
      await e2e.db.sql<Json[]>`
        SELECT phone_e164, full_name, email, default_city_id, marketing_opt_in,
               promo_use_consent, promo_consent_at, blocked_reason, deleted_at
        FROM users WHERE id = ${id}`
    )[0];
  const count = async (table: string, where: string, value: string): Promise<number> => {
    const [row] = await e2e.db.sql.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ${table} WHERE ${where} = $1`,
      [value],
    );
    return row?.n ?? 0;
  };
  /** A review item on the paid booking ("To settle"), as a subscriber would raise it. */
  const raiseReview = async (reason: string): Promise<string> => {
    const [row] = await e2e.db.sql<{ event_id: string }[]>`
      INSERT INTO domain_events (event_type, aggregate_kind, aggregate_id, payload, occurred_at)
      VALUES ('booking.needs_review', 'booking', ${paid.id as string},
              ${e2e.db.sql.json({ booking_id: paid.id as string, reason })}, ${e2e.now()})
      RETURNING event_id::text`;
    return row?.event_id ?? '';
  };
  const settleReview = (eventId: string) =>
    e2e
      .get(ReviewsService)
      .settle(
        eventId,
        { outcome: 'NO_ACTION', note: 'Nothing owed after checking' },
        { staffId: finance, roles: ['FINANCE'] },
      );
  const bookingBody = (promoCode?: string) => ({
    tier: 'PROFESSIONAL',
    categoryCode: 'FOOD',
    pincode: '395007',
    scheduledStart: new Date(NOW.getTime() + 9 * DAY).toISOString(),
    hours: 2,
    venueAddress: '12 Ghod Dod Road, Surat',
    booker: { name: 'Rohan Shah', phone: '+919700000888' },
    modelReleaseConsent: false,
    acceptedTermsVersion: '2.0',
    ...(promoCode ? { promoCode } : {}),
  });
  const transition = async (to: 'UPLOADING' | 'DATA_LOSS') => {
    const at = e2e.now();
    await e2e.db.sql.begin((tx) =>
      e2e.get(BookingsService).transition(tx, {
        bookingId: paid.id as string,
        to,
        actor: { kind: to === 'DATA_LOSS' ? 'STAFF' : 'PHOTOGRAPHER', id: null },
        occurredAt: at,
        reason: 'account deletion test',
      }),
    );
  };

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    qm = (await bootstrapStaff(e2e, 'qm@clickco.test', 'QUALITY_MANAGER')).id;
    finance = (await bootstrapStaff(e2e, 'finance@clickco.test', 'FINANCE')).id;
    pro = await insertPhotographer(e2e.db.sql, {
      phone: '+919999177001',
      name: 'Asha Patel',
      km: 3,
      categories: [{ code: 'FOOD', tier: 'EXPERT' }],
    });
    session = await signIn(PHONE);
    userId = session.user.id as string;
    expect(session.user.isNew).toBe(true);
    paid = await bookAndPay(e2e, userId, new Date(NOW.getTime() + 4 * DAY));
    assignmentId = await acceptOffer(e2e, pro, paid.id as string);
  }, 240_000);

  afterAll(async () => {
    await e2e?.close();
  });

  it('explains what goes and what stays, and refuses while a paid booking is unfinished', async () => {
    const preview = await me('/deletion');
    expect(preview.status).toBe(200);
    expect(preview.json.data).toMatchObject({
      canDelete: false,
      blockers: [
        {
          kind: 'BOOKING_IN_PROGRESS',
          bookingId: paid.id,
          reference: paid.reference,
        },
      ],
      forfeitedCreditPaise: 0,
    });
    expect(preview.json.data.blockers[0].message).toContain(paid.reference);
    expect(preview.json.data.erases.length).toBeGreaterThan(3);
    expect(preview.json.data.keeps.join(' ')).toMatch(/invoice/i);

    const before = await count('otp_challenges', 'phone_e164', PHONE);
    const request = await me('/deletion/request', 'POST');
    expect(request.status).toBe(409);
    expect(request.json.error).toMatchObject({ code: 'ACCOUNT_DELETION_BLOCKED' });
    expect(request.json.error.message).toContain(paid.reference);
    expect(request.json.error.details.blockers).toHaveLength(1);
    // No code is sent while deletion cannot happen.
    expect(await count('otp_challenges', 'phone_e164', PHONE)).toBe(before);

    const confirm = await me(
      '/deletion/confirm',
      'POST',
      { challengeId: '00000000-0000-4000-8000-000000000000', code: '123456' },
      idemKey('delete-blocked'),
    );
    expect(confirm.status).toBe(409);
    expect(confirm.json.error.code).toBe('ACCOUNT_DELETION_BLOCKED');
    expect((await userRow(userId))?.phone_e164).toBe(PHONE);
  });

  it('a refund still being settled blocks deletion too, until it is decided', async () => {
    await walkTo(e2e, paid.id as string, assignmentId, 'CHECKED_OUT', 40);
    await transition('UPLOADING');
    await transition('DATA_LOSS');
    await drainOutbox(e2e);
    const refunds = e2e.get(RefundsService);
    const [refund] = await refunds.request({
      bookingId: paid.id as string,
      amountPaise: 10_000n,
      reasonCode: 'GOODWILL',
      note: 'Sorry for the trouble',
      staffId: qm,
    });
    const blocked = await me('/deletion');
    expect(blocked.json.data).toMatchObject({
      canDelete: false,
      blockers: [{ kind: 'MONEY_BEING_SETTLED', bookingId: paid.id }],
    });
    await refunds.reject(
      refund?.id ?? '',
      { staffId: finance, roles: ['FINANCE'] },
      'Not needed: the loss refund covers it',
    );
    const open = await me('/deletion');
    expect(open.json.data).toMatchObject({ canDelete: true, blockers: [] });
  });

  it('an open review item on a booking (money that may be owed) blocks deletion too', async () => {
    const eventId = await raiseReview('REFUND_DUE_NO_SHOW');
    const blocked = await me('/deletion');
    expect(blocked.json.data).toMatchObject({
      canDelete: false,
      blockers: [{ kind: 'MONEY_BEING_SETTLED', bookingId: paid.id }],
    });
    await settleReview(eventId);
    expect((await me('/deletion')).json.data).toMatchObject({ canDelete: true });
  });

  it('a wrong code changes nothing (and is not a session error)', async () => {
    const { challengeId, code } = await requestCode();
    const wrong = code === '000000' ? '111111' : '000000';
    const res = await me(
      '/deletion/confirm',
      'POST',
      { challengeId, code: wrong },
      idemKey('delete-wrong'),
    );
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe('OTP_INVALID');
    expect((await userRow(userId))?.deleted_at).toBeNull();
  });

  it('success anonymises the personal fields and keeps invoices, payments, ledger and audit', async () => {
    // Personal data across the modules that hold it.
    await e2e.db.sql`
      UPDATE users SET full_name = 'Rohan Shah', email = 'rohan@example.com',
             marketing_opt_in = true, promo_use_consent = true, promo_consent_at = ${NOW}
      WHERE id = ${userId}`;
    expect(
      (await me('/push-tokens', 'POST', { token: PUSH_TOKEN, platform: 'ios' })).status,
    ).toBeLessThan(300);
    expect(
      (await me('/notification-preferences', 'POST', { whatsappOptIn: true })).status,
    ).toBeLessThan(300);
    expect((await me('/blocks', 'POST', { photographerId: pro })).status).toBeLessThan(300);
    const [written] = await e2e.db.sql<{ id: string }[]>`
      INSERT INTO reviews (booking_id, direction, photographer_id, rating, comment)
      VALUES (${paid.id as string}, 'CLIENT_TO_PRO', ${pro}, 4, 'Lovely work, ask for Rohan')
      RETURNING id`;
    // Reports: the photographer reported the client's review (a copy of its words is kept on the
    // report), and the client reported the photographer in their own words.
    await e2e.db.sql`
      INSERT INTO moderation_reports (reporter_kind, reporter_id, target_kind, target_id, booking_id,
                                      city_id, reason, reported_rating, reported_comment)
      SELECT 'PHOTOGRAPHER', ${pro}, 'REVIEW', ${written?.id ?? ''}, id, city_id, 'ABUSIVE', 4,
             'Lovely work, ask for Rohan'
      FROM bookings WHERE id = ${paid.id as string}`;
    await e2e.db.sql`
      INSERT INTO moderation_reports (reporter_kind, reporter_id, target_kind, target_id, booking_id,
                                      city_id, reason, note)
      SELECT 'USER', ${userId}, 'PHOTOGRAPHER', ${pro}, id, city_id, 'OTHER',
             'Rude to me, call me on 9999377001'
      FROM bookings WHERE id = ${paid.id as string}`;
    // The full UPI id (often the phone) on the client's payment.
    await e2e.db.sql`
      UPDATE payments SET method = 'UPI', vpa_or_last4 = '9999377001@ybl'
      WHERE booking_id = ${paid.id as string}`;
    await e2e.db.sql`
      INSERT INTO waitlist_entries (phone_e164, full_name, pincode)
      VALUES (${PHONE}, 'Rohan Shah', '400001')`;
    const draft = await e2e.call('POST', '/bookings', {
      token: session.accessToken,
      idempotencyKey: idemKey('unpaid'),
      body: {
        tier: 'PROFESSIONAL',
        categoryCode: 'FOOD',
        pincode: '395007',
        scheduledStart: new Date(NOW.getTime() + 9 * DAY).toISOString(),
        hours: 2,
        venueAddress: '12 Ghod Dod Road, Surat',
        venueLandmark: 'Opposite the park',
        booker: { name: 'Rohan Shah', phone: '+919700000888' },
        subject: { name: 'Meera Shah', phone: '+919700000999' },
        galleryRecipient: 'SUBJECT',
        specialRequirements: 'Gate code 4411',
        modelReleaseConsent: false,
        acceptedTermsVersion: '2.0',
      },
    });
    expect(draft.status).toBe(201);
    unpaidId = draft.json.data.booking.id as string;

    const kept = async () => ({
      invoices: await e2e.db.sql<Json[]>`
        SELECT id, invoice_number, booking_id, user_id, total_amount_paise::text AS total
        FROM invoices WHERE booking_id = ${paid.id as string} ORDER BY id`,
      payments: await count('payments', 'user_id', userId),
      ledger: await count('ledger_entries', 'booking_id', paid.id as string),
      creditNotes: await count('credit_notes', 'user_id', userId),
      statusEvents: await count('booking_status_events', 'booking_id', paid.id as string),
      audit: (await e2e.db.sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_logs`)[0]?.n,
    });
    const before = await kept();
    expect(before.invoices.length).toBeGreaterThan(0);
    expect(before.payments).toBeGreaterThan(0);
    expect(before.ledger).toBeGreaterThan(0);

    confirmBody = await requestCode();
    // A blocker appearing after the code was sent refuses the deletion without using the code up.
    const late = await raiseReview('REFUND_DUE_UNFILLED');
    const refused = await me('/deletion/confirm', 'POST', confirmBody, confirmKey);
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe('ACCOUNT_DELETION_BLOCKED');
    expect((await userRow(userId))?.deleted_at).toBeNull();
    await settleReview(late);
    const res = await me('/deletion/confirm', 'POST', confirmBody, confirmKey);
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ deleted: true, deletedAt: e2e.now().toISOString() });
    deletedAt = res.json.data.deletedAt as string;

    expect(await userRow(userId)).toEqual({
      phone_e164: null,
      full_name: null,
      email: null,
      default_city_id: null,
      marketing_opt_in: false,
      promo_use_consent: false,
      promo_consent_at: null,
      blocked_reason: null,
      deleted_at: new Date(deletedAt),
    });
    const bookings = await e2e.db.sql<Json[]>`
      SELECT id, status, user_id, booker_name, booker_phone, subject_name, subject_phone,
             gallery_recipient, venue_address, venue_landmark, venue_location,
             special_requirements, venue_pincode, total_paise::text AS total
      FROM bookings WHERE user_id = ${userId} ORDER BY created_at`;
    expect(bookings).toHaveLength(2);
    for (const b of bookings) {
      expect(b).toMatchObject({
        user_id: userId,
        booker_name: 'Deleted account',
        booker_phone: '',
        subject_name: null,
        subject_phone: null,
        gallery_recipient: 'BOOKER',
        venue_landmark: null,
        venue_location: null,
        special_requirements: null,
        venue_pincode: '395007',
      });
      expect(b.venue_address).not.toMatch(/Surat|Athwa|Ghod/);
    }
    expect(bookings.find((b) => b.id === paid.id)?.status).toBe('DATA_LOSS');
    expect(bookings.find((b) => b.id === unpaidId)?.status).toBe('CANCELLED_CLIENT');

    expect(await count('device_push_tokens', 'user_id', userId)).toBe(0);
    expect(await count('notification_preferences', 'user_id', userId)).toBe(0);
    expect(await count('client_photographer_blocks', 'user_id', userId)).toBe(0);
    expect(await count('waitlist_entries', 'phone_e164', PHONE)).toBe(0);
    expect(await count('otp_challenges', 'phone_e164', PHONE)).toBe(0);
    const devices = await e2e.db.sql<{ device_id: string | null; user_agent: string | null }[]>`
      SELECT device_id, user_agent FROM refresh_tokens
      WHERE subject_kind = 'USER' AND subject_id = ${userId}`;
    expect(devices.length).toBeGreaterThan(0);
    expect(devices.every((d) => d.device_id === null && d.user_agent === null)).toBe(true);
    const reports = await e2e.db.sql<Json[]>`
      SELECT reporter_kind, note, reported_rating, reported_comment FROM moderation_reports
      ORDER BY reporter_kind`;
    expect(reports).toEqual([
      { reporter_kind: 'PHOTOGRAPHER', note: null, reported_rating: 4, reported_comment: null },
      { reporter_kind: 'USER', note: null, reported_rating: null, reported_comment: null },
    ]);
    const [payment] = await e2e.db.sql<{ vpa: string }[]>`
      SELECT vpa_or_last4 AS vpa FROM payments WHERE booking_id = ${paid.id as string}`;
    expect(payment?.vpa).toBe('•••@ybl');
    // Stored answers of earlier requests (a booking's venue and phones) are gone; only this
    // request's own answer (no personal data) stays, for its replay.
    const stored = await e2e.db.sql<{ key: string; body: unknown }[]>`
      SELECT key, response_body AS body FROM idempotency_keys
      WHERE key LIKE ${`USER:${userId}:%`}`;
    expect(stored.map((k) => k.key)).toEqual([`USER:${userId}:${confirmKey}`]);
    expect(JSON.stringify(stored[0]?.body)).not.toMatch(/Ghod|Athwa|9700000888|9999377001/);
    const [cancelled] = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events
      WHERE event_type = 'booking.cancelled_client' AND aggregate_id = ${unpaidId}`;
    expect(cancelled?.payload).toMatchObject({ reason: 'ACCOUNT_DELETED' });
    const [review] = await e2e.db.sql<Json[]>`
      SELECT rating, comment, photographer_id FROM reviews WHERE booking_id = ${paid.id as string}`;
    expect(review).toEqual({ rating: 4, comment: null, photographer_id: pro });

    // What the law needs stays, still pointing at the same (anonymous) account and booking.
    const after = await kept();
    expect(after.invoices).toEqual(before.invoices);
    expect(after).toMatchObject({
      payments: before.payments,
      ledger: before.ledger,
      creditNotes: before.creditNotes,
    });
    expect(after.statusEvents).toBe(before.statusEvents);
    expect(after.audit).toBe(before.audit);

    const events = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events
      WHERE event_type = 'user.deleted' AND aggregate_id = ${userId}`;
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ user_id: userId, deleted_at: deletedAt });
    expect(JSON.stringify(events[0]?.payload)).not.toContain(PHONE.slice(3));
    // Drained, the outbox raises no dead letters for the cancellation or the deletion.
    await drainOutbox(e2e);
    const dead = await e2e.db.sql`SELECT 1 FROM domain_events WHERE event_type = 'ops.dead_letter'`;
    expect(dead).toHaveLength(0);
  });

  it('every old session fails: the access token, the refresh token, a pre-minted token', async () => {
    expect((await me('')).status).toBe(401);
    expect((await me('/deletion')).status).toBe(401);
    const list = await e2e.call('GET', '/bookings', { token: session.accessToken });
    expect(list.status).toBe(401);
    const refresh = await e2e.call('POST', '/auth/refresh', {
      body: { refreshToken: session.refreshToken },
    });
    expect(refresh.status).toBe(401);
    const live = await e2e.db.sql`
      SELECT 1 FROM refresh_tokens
      WHERE subject_kind = 'USER' AND subject_id = ${userId} AND revoked_at IS NULL`;
    expect(live).toHaveLength(0);
    // Even a token minted for the old id afterwards (no sign-in path can: the account has no
    // phone) is refused on every client route.
    const minted = await tokenFor(e2e, 'USER', userId);
    expect((await e2e.call('GET', '/me', { token: minted })).status).toBe(401);
  });

  it('a repeated confirm is idempotent: the same answer, one deletion', async () => {
    const replay = await me('/deletion/confirm', 'POST', { challengeId: userId, code: '123456' });
    // Without a key it is refused before anything runs.
    expect(replay.status).toBe(400);
    const same = await e2e.call('POST', '/me/deletion/confirm', {
      token: session.accessToken,
      idempotencyKey: confirmKey,
      body: confirmBody,
    });
    expect(same.status).toBe(200);
    expect(same.headers.get('idempotent-replayed')).toBe('true');
    expect(same.json.data).toEqual({ deleted: true, deletedAt });
    const another = await e2e.call('POST', '/me/deletion/confirm', {
      token: session.accessToken,
      idempotencyKey: idemKey('delete-again'),
      body: { challengeId: '00000000-0000-4000-8000-000000000001', code: '123456' },
    });
    expect(another.status).toBe(200);
    expect(another.json.data).toEqual({ deleted: true, deletedAt });
    const events = await e2e.db.sql`
      SELECT 1 FROM domain_events WHERE event_type = 'user.deleted' AND aggregate_id = ${userId}`;
    expect(events).toHaveLength(1);
  });

  it('the database refuses to revive the account or attach new rows to it', async () => {
    await expect(
      e2e.db.sql`UPDATE users SET full_name = 'Back again' WHERE id = ${userId}`,
    ).rejects.toThrow(/deleted account cannot change/);
    await expect(
      e2e.db.sql`
        INSERT INTO client_photographer_blocks (user_id, photographer_id)
        VALUES (${userId}, ${pro})`,
    ).rejects.toThrow(/deleted their account/);
    await expect(
      e2e.db.sql`
        INSERT INTO notification_preferences (user_id) VALUES (${userId})`,
    ).rejects.toThrow(/deleted their account/);
  });

  it('the same phone signs up again later as a fresh, empty account', async () => {
    e2e.advance(31_000);
    const fresh = await signIn(PHONE);
    expect(fresh.user).toMatchObject({ phone: PHONE, fullName: null, isNew: true });
    expect(fresh.user.id).not.toBe(userId);
    const mine = await e2e.call('GET', '/me', { token: fresh.accessToken });
    expect(mine.json.data).toEqual({ id: fresh.user.id, phone: PHONE, fullName: null });
    const list = await e2e.call('GET', '/bookings', { token: fresh.accessToken });
    expect(list.json.data).toEqual([]);
    const preview = await e2e.call('GET', '/me/deletion', { token: fresh.accessToken });
    expect(preview.json.data).toMatchObject({ canDelete: true, blockers: [] });

    // A first-booking promo is not a first booking again for the same number (ADR-0030).
    await e2e.db.sql`
      INSERT INTO promo_codes (code, discount_bps, first_booking_only, valid_from, valid_to)
      VALUES ('FIRSTSHOOT', 1000, true, ${new Date(NOW.getTime() - DAY)},
              ${new Date(NOW.getTime() + 90 * DAY)})`;
    const reused = await e2e.call('POST', '/bookings', {
      token: fresh.accessToken,
      idempotencyKey: idemKey('promo-again'),
      body: bookingBody('FIRSTSHOOT'),
    });
    expect(reused.status).toBe(422);
    expect(reused.json.error.code).toBe('PROMO_NOT_APPLICABLE');
    // A number that never booked still gets it.
    const newcomer = await insertClient(e2e, '+919999377555');
    const first = await e2e.call('POST', '/bookings', {
      token: await tokenFor(e2e, 'USER', newcomer),
      idempotencyKey: idemKey('promo-first'),
      body: bookingBody('FIRSTSHOOT'),
    });
    expect(first.status).toBe(201);
    expect((await userRow(userId))?.deleted_at).toEqual(new Date(deletedAt));
  });
});
