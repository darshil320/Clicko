import { randomUUID } from 'node:crypto';
import { MaskedCallResponse, NotificationPreferencesView } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendDomainEvent } from './infra/outbox/outbox';
import { OutboxSubscribers, type PublishedEvent } from './infra/outbox/outbox-subscribers';
import { JobRegistry } from './infra/queues/job-registry';
import { JOB } from './infra/queues/queue-names';
import { BookingsService } from './modules/bookings/bookings.service';
import { ConsoleCallsAdapter } from './modules/calls/adapters/console-calls.adapter';
import { CALLS_CONFIG } from './modules/calls/calls.config';
import { CALLS_PORT } from './modules/calls/calls.port';
import {
  NOTIFICATION_SMS_PORT,
  PUSH_PORT,
  WHATSAPP_PORT,
} from './modules/notifications/channels/channel.ports';
import type {
  ConsoleNotificationSmsAdapter,
  ConsolePushAdapter,
  ConsoleWhatsAppAdapter,
} from './modules/notifications/channels/console-channels';
import { jobFor } from './modules/notifications/pipeline/notification-enqueuer';
import { NotificationSender } from './modules/notifications/pipeline/notification-sender';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import {
  acceptOffer,
  bookAndPay,
  fixAt,
  idemKey,
  insertClient,
  SURAT_CENTRE,
  setNow,
  tokenFor,
} from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';

const NOW = new Date('2026-11-10T06:30:00.000Z'); // Tuesday 12:00 IST
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const START = new Date(NOW.getTime() + 5 * DAY); // Sunday 15 Nov, 12:00 IST
const CLIENT_PHONE = '+919999210801';
const OTHER_CLIENT_PHONE = '+919999210802';
const PRO_PHONE = '+919999110801';
const SECRET = 'e2e-exotel-webhook-secret-0123456789abcdef';
const PUBLIC_API_URL = 'https://api.clickco.test';
const CLIENT_TOKEN = 'ExponentPushToken[clientphoneAAAAAAAAAAAAA]';
const SHARED_TOKEN = 'ExponentPushToken[sharedtabletBBBBBBBBBBBB]';
const PRO_TOKEN = 'ExponentPushToken[prophoneCCCCCCCCCCCCCCCC]';

interface SendRow {
  template_code: string;
  channel: string | null;
  status: string;
  recipient_kind: string;
  destination_masked: string | null;
  error_code: string | null;
}

describe.runIf(TEST_DATABASE_URL)(
  'notifications end to end: lifecycle messages, preferences, push tokens, masked calls',
  () => {
    let e2e: E2eApp;
    let userId: string;
    let otherUserId: string;
    let proId: string;
    let bookingId: string;
    let assignmentId: string;
    let checkedOutAt: Date;
    let whatsapp: ConsoleWhatsAppAdapter;
    let sms: ConsoleNotificationSmsAdapter;
    let push: ConsolePushAdapter;
    let calls: ConsoleCallsAdapter;
    const client = () => tokenFor(e2e, 'USER', userId);
    const pro = () => tokenFor(e2e, 'PHOTOGRAPHER', proId);

    /** Runs the queued notification jobs that are due now (and only those). */
    const sendDue = () =>
      e2e.scheduler.runDue(e2e.get(JobRegistry), e2e.now(), JOB.NOTIFICATION_SEND);
    const sends = (template?: string) =>
      e2e.db.sql<SendRow[]>`
        SELECT template_code, channel, status, recipient_kind, destination_masked, error_code
        FROM notification_sends
        WHERE ${template ? e2e.db.sql`template_code = ${template}` : e2e.db.sql`true`}
        ORDER BY id`;
    const proCall = async (path: string, body?: unknown) =>
      e2e.call('POST', `/pro/assignments/${assignmentId}/${path}`, {
        token: await pro(),
        idempotencyKey: idemKey(path),
        ...(body === undefined ? {} : { body }),
      });
    const lastWhatsApp = () => whatsapp.sent[whatsapp.sent.length - 1];

    beforeAll(async () => {
      e2e = await startE2eApp({
        now: NOW,
        nodeEnv: 'development',
        env: { EXOTEL_WEBHOOK_SECRET: SECRET, PUBLIC_API_URL },
      });
      proId = await insertPhotographer(e2e.db.sql, {
        phone: PRO_PHONE,
        name: 'Meera Joshi',
        km: 3,
        categories: [{ code: 'FOOD', tier: 'EXPERT' }],
      });
      userId = await insertClient(e2e, CLIENT_PHONE);
      otherUserId = await insertClient(e2e, OTHER_CLIENT_PHONE);
      whatsapp = e2e.get(WHATSAPP_PORT);
      sms = e2e.get(NOTIFICATION_SMS_PORT);
      push = e2e.get(PUSH_PORT);
      calls = e2e.get(CALLS_PORT);
      expect(calls).toBeInstanceOf(ConsoleCallsAdapter);
    }, 60_000);

    afterAll(async () => {
      await e2e?.close();
    });

    it('push tokens: register, move to a new owner on re-register, revoke on sign-out', async () => {
      const mine = await e2e.call('POST', '/me/push-tokens', {
        token: await client(),
        body: { token: CLIENT_TOKEN, platform: 'android' },
      });
      expect(mine.status).toBe(200);
      expect(mine.json.data).toEqual({
        registered: true,
        platform: 'android',
        lastSeenAt: NOW.toISOString(),
      });
      const proReg = await e2e.call('POST', '/pro/push-tokens', {
        token: await pro(),
        body: { token: PRO_TOKEN, platform: 'ios' },
      });
      expect(proReg.status).toBe(200);

      // A shared tablet: first the other client, then this one signs in on it.
      const other = await tokenFor(e2e, 'USER', otherUserId);
      const held = () =>
        e2e.db.sql<{ user_id: string; revoked_at: Date | null }[]>`
          SELECT user_id, revoked_at FROM device_push_tokens WHERE expo_token = ${SHARED_TOKEN}`;
      const registerShared = async (t: string) =>
        e2e.call('POST', '/me/push-tokens', {
          token: t,
          body: { token: SHARED_TOKEN, platform: 'android' },
        });
      expect((await registerShared(other)).json.data.registered).toBe(true);
      // Live on another account and seen just now: revoked, never taken over (review L4).
      expect((await registerShared(await client())).json.data.registered).toBe(false);
      expect(await held()).toEqual([{ user_id: otherUserId, revoked_at: NOW }]);
      // The app registers again on its next start: now the token moves.
      expect((await registerShared(await client())).json.data.registered).toBe(true);
      expect(await held()).toEqual([{ user_id: userId, revoked_at: null }]);

      // The other client cannot revoke it any more; this one can (same answer either way).
      const notTheirs = await e2e.call('POST', '/me/push-tokens/unregister', {
        token: other,
        body: { token: SHARED_TOKEN },
      });
      expect(notTheirs.json.data).toEqual({ unregistered: true });
      const mineOff = await e2e.call('POST', '/me/push-tokens/unregister', {
        token: await client(),
        body: { token: SHARED_TOKEN },
      });
      expect(mineOff.status).toBe(200);
      const live = await e2e.db.sql<{ expo_token: string }[]>`
        SELECT expo_token FROM device_push_tokens WHERE user_id = ${userId} AND revoked_at IS NULL`;
      expect(live.map((t) => t.expo_token)).toEqual([CLIENT_TOKEN]);

      const bad = await e2e.call('POST', '/me/push-tokens', {
        token: await client(),
        body: { token: 'fcm:raw', platform: 'android' },
      });
      expect(bad.status).toBe(400);
      const wrongApp = await e2e.call('POST', '/me/push-tokens', {
        token: await pro(),
        body: { token: PRO_TOKEN, platform: 'ios' },
      });
      expect(wrongApp.status).toBe(403);
      const anonymous = await e2e.call('POST', '/pro/push-tokens', {
        body: { token: PRO_TOKEN, platform: 'ios' },
      });
      expect(anonymous.status).toBe(401);
    });

    it('an account keeps at most 10 live push tokens (the least recently seen go first)', async () => {
      const other = await tokenFor(e2e, 'USER', otherUserId);
      for (let i = 0; i < 11; i++) {
        e2e.advance(1_000);
        const res = await e2e.call('POST', '/me/push-tokens', {
          token: other,
          body: {
            token: `ExponentPushToken[flood${String(i).padStart(12, '0')}]`,
            platform: 'ios',
          },
        });
        expect(res.status).toBe(200);
      }
      const live = await e2e.db.sql<{ expo_token: string }[]>`
        SELECT expo_token FROM device_push_tokens
        WHERE user_id = ${otherUserId} AND revoked_at IS NULL ORDER BY expo_token`;
      expect(live).toHaveLength(10);
      expect(live.map((t) => t.expo_token)).not.toContain('ExponentPushToken[flood000000000000]');
    });

    it('preferences: defaults, a WhatsApp opt-in stamped with its time, partial updates', async () => {
      const initial = await e2e.call('GET', '/me/notification-preferences', {
        token: await client(),
      });
      expect(initial.json.data).toEqual({
        whatsappOptIn: false,
        muteWhatsapp: false,
        muteSms: false,
        mutePush: false,
        updatedAt: null,
      });
      const optIn = await e2e.call('POST', '/me/notification-preferences', {
        token: await client(),
        body: { whatsappOptIn: true },
      });
      expect(optIn.status).toBe(200);
      expect(NotificationPreferencesView.parse(optIn.json.data)).toMatchObject({
        whatsappOptIn: true,
        muteSms: false,
      });
      const [row] = await e2e.db.sql<{ whatsapp_opt_in_at: Date | null }[]>`
        SELECT whatsapp_opt_in_at FROM notification_preferences WHERE user_id = ${userId}`;
      expect(row?.whatsapp_opt_in_at).toEqual(e2e.now());

      const empty = await e2e.call('POST', '/me/notification-preferences', {
        token: await client(),
        body: {},
      });
      expect(empty.status).toBe(400);
      const proPrefs = await e2e.call('GET', '/pro/notification-preferences', {
        token: await pro(),
      });
      expect(proPrefs.json.data.whatsappOptIn).toBe(false);
    });

    it('booking confirmed → WhatsApp and push to the client; the wave → push to the photographer', async () => {
      const booking = await bookAndPay(e2e, userId, START);
      bookingId = booking.id as string;
      expect(await sendDue()).toBeGreaterThanOrEqual(2);

      const confirmed = whatsapp.sent.find((s) => s.templateCode === 'BOOKING_CONFIRMED');
      expect(confirmed).toMatchObject({
        to: CLIENT_PHONE,
        variables: { bookingRef: booking.reference, when: 'Sun 15 Nov, 12:00 pm' },
      });
      expect(sms.sent).toEqual([]); // WhatsApp went: no SMS fallback needed
      expect(push.sent.map((p) => [p.title, p.tokens])).toEqual(
        expect.arrayContaining([
          ['Booking confirmed', [CLIENT_TOKEN]],
          ['New job offer', [PRO_TOKEN]],
        ]),
      );
      const offer = push.sent.find((p) => p.title === 'New job offer');
      expect(offer?.data).toEqual({ template: 'PRO_NEW_OFFER', bookingId });
      expect(offer?.body).toMatch(/^New job on Sun 15 Nov, 12:00 pm, earn ₹[\d,]+/);

      expect(await sends('BOOKING_CONFIRMED')).toEqual([
        {
          template_code: 'BOOKING_CONFIRMED',
          channel: 'WHATSAPP',
          status: 'SENT',
          recipient_kind: 'USER',
          destination_masked: '******0801',
          error_code: null,
        },
        expect.objectContaining({
          channel: 'PUSH',
          status: 'SENT',
          destination_masked: 'ExponentPushToken[…AAAA]',
        }),
      ]);
      expect(await sends('PRO_NEW_OFFER')).toEqual([
        expect.objectContaining({
          channel: 'PUSH',
          status: 'SENT',
          recipient_kind: 'PHOTOGRAPHER',
        }),
      ]);
    });

    it('a redelivered event (and a re-run job) sends nothing twice', async () => {
      const before = {
        rows: (await sends()).length,
        wa: whatsapp.sent.length,
        push: push.sent.length,
      };
      const [row] = await e2e.db.sql<
        {
          event_id: string;
          event_type: string;
          aggregate_kind: string;
          aggregate_id: string;
          payload: Record<string, unknown>;
          occurred_at: Date;
        }[]
      >`
        SELECT event_id, event_type, aggregate_kind, aggregate_id, payload, occurred_at
        FROM domain_events WHERE aggregate_id = ${bookingId} AND event_type = 'booking.confirmed'`;
      if (!row) throw new Error('no booking.confirmed event');
      const event: PublishedEvent = {
        eventId: row.event_id,
        eventType: row.event_type,
        aggregateKind: row.aggregate_kind,
        aggregateId: row.aggregate_id,
        payload: row.payload,
        occurredAt: row.occurred_at,
      };
      const ours = e2e
        .get(OutboxSubscribers)
        .subscribersOf('booking.confirmed')
        .find((s) => s.name === 'notifications.enqueue');
      await ours?.handle(event);
      await sendDue();
      // BullMQ dropped the completed job: the same job running again finds the SENT rows.
      await e2e
        .get(NotificationSender)
        .process(jobFor(event.eventId, 'BOOKING_CONFIRMED', { kind: 'USER', id: userId }));
      expect((await sends()).length).toBe(before.rows);
      expect(whatsapp.sent.length).toBe(before.wa);
      expect(push.sent.length).toBe(before.push);
    });

    it('photographer assigned → first name and the virtual number; the call window opens', async () => {
      assignmentId = await acceptOffer(e2e, proId, bookingId);
      await sendDue();
      const assigned = lastWhatsApp();
      expect(assigned).toMatchObject({
        templateCode: 'PHOTOGRAPHER_ASSIGNED',
        to: CLIENT_PHONE,
        variables: expect.objectContaining({
          photographerName: 'Meera',
          callNumber: CALLS_CONFIG.consoleVirtualNumber,
        }),
      });
      expect(assigned?.text).not.toContain(PRO_PHONE.slice(3));
      const [binding] = await e2e.db.sql<
        { assignment_id: string; user_id: string; virtual_number: string; closes_at: Date | null }[]
      >`SELECT assignment_id, user_id, virtual_number, closes_at FROM call_bindings
        WHERE booking_id = ${bookingId}`;
      expect(binding).toEqual({
        assignment_id: assignmentId,
        user_id: userId,
        virtual_number: CALLS_CONFIG.consoleVirtualNumber,
        closes_at: null,
      });
    });

    it('masked calls: either side calls through the virtual number; the status logs duration only', async () => {
      const fromClient = await e2e.call('POST', `/bookings/${bookingId}/call`, {
        token: await client(),
      });
      expect(fromClient.status).toBe(200);
      const answer = MaskedCallResponse.parse(fromClient.json.data);
      expect(answer).toMatchObject({
        bookingId,
        virtualNumber: CALLS_CONFIG.consoleVirtualNumber,
        status: 'CONNECTING',
      });
      expect(JSON.stringify(fromClient.json)).not.toContain(PRO_PHONE.slice(3));

      const fromPro = await e2e.call('POST', `/pro/assignments/${assignmentId}/call`, {
        token: await pro(),
      });
      expect(fromPro.status).toBe(200);
      expect(JSON.stringify(fromPro.json)).not.toContain(CLIENT_PHONE.slice(3));
      expect(calls.placed.map((c) => [c.from, c.to, c.statusCallbackUrl])).toEqual([
        [CLIENT_PHONE, PRO_PHONE, `${PUBLIC_API_URL}${CALLS_CONFIG.webhookPath}/${SECRET}`],
        [PRO_PHONE, CLIENT_PHONE, `${PUBLIC_API_URL}${CALLS_CONFIG.webhookPath}/${SECRET}`],
      ]);

      const stranger = await tokenFor(e2e, 'USER', otherUserId);
      const notTheirs = await e2e.call('POST', `/bookings/${bookingId}/call`, { token: stranger });
      expect(notTheirs.status).toBe(404);
      const otherPro = await e2e.call('POST', `/pro/assignments/${randomUUID()}/call`, {
        token: await pro(),
      });
      expect(otherPro.status).toBe(404);

      const status = (secret: string, body: Json) =>
        e2e.call('POST', `/webhooks/exotel/call-status/${secret}`, { body });
      const completed = {
        CallSid: calls.placed[0]?.providerCallId,
        EventType: 'terminal',
        Status: 'completed',
        ConversationDuration: 42,
        RecordingUrl: 'https://recordings.example/never-stored.mp3',
      };
      expect((await status('wrong-secret-wrong-secret-wrong-secret', completed)).status).toBe(404);
      expect((await status(SECRET, completed)).json.data).toEqual({
        received: true,
        outcome: 'RECORDED',
      });
      expect((await status(SECRET, completed)).json.data.outcome).toBe('DUPLICATE');
      expect(
        (await status(SECRET, { ...completed, CallSid: 'never-placed' })).json.data.outcome,
      ).toBe('UNKNOWN_CALL');

      const logs = await e2e.db.sql<
        { call_id: string; caller_kind: string; status: string; duration_seconds: number | null }[]
      >`SELECT call_id, caller_kind, status, duration_seconds FROM call_logs
        WHERE booking_id = ${bookingId} ORDER BY id`;
      // Reserved (REQUESTED) under the per-caller lock, then INITIATED with the provider's id.
      expect(logs.map((l) => [l.caller_kind, l.status, l.duration_seconds])).toEqual([
        ['USER', 'REQUESTED', null],
        ['USER', 'INITIATED', null],
        ['PHOTOGRAPHER', 'REQUESTED', null],
        ['PHOTOGRAPHER', 'INITIATED', null],
        ['USER', 'COMPLETED', 42],
      ]);
      expect(logs[4]?.call_id).toBe(answer.callId);

      // Six more at once: with one already in the window, the lock lets exactly four through
      // (security review M1: the cap cannot be raced).
      const burst = await Promise.all(
        Array.from({ length: 6 }, async () =>
          e2e.call('POST', `/bookings/${bookingId}/call`, { token: await client() }),
        ),
      );
      expect(burst.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 429, 429]);
      expect(burst.find((r) => r.status === 429)?.json.error.code).toBe('TOO_MANY_CALLS');
    });

    it('on the way, checked in, extension asked, checked out: the client hears each', async () => {
      setNow(e2e, new Date(START.getTime() - 40 * MIN));
      expect((await proCall('en-route')).status).toBe(200);
      await drainOutbox(e2e);
      await sendDue();
      expect(lastWhatsApp()?.templateCode).toBe('PHOTOGRAPHER_ON_THE_WAY');

      setNow(e2e, new Date(START.getTime() - 10 * MIN));
      expect((await proCall('check-in', fixAt(0.05, 0, SURAT_CENTRE))).status).toBe(200);
      await drainOutbox(e2e);
      await sendDue();
      expect(lastWhatsApp()).toMatchObject({
        templateCode: 'CHECKED_IN',
        variables: expect.objectContaining({ photographerName: 'Meera' }),
      });

      setNow(e2e, new Date(START.getTime() + 5 * MIN));
      expect((await proCall('start')).status).toBe(200);
      setNow(e2e, new Date(START.getTime() + 90 * MIN));
      const ext = await proCall('extensions', { hours: 1 });
      expect(ext.status).toBe(201);
      await drainOutbox(e2e);
      await sendDue();
      expect(lastWhatsApp()).toMatchObject({
        templateCode: 'EXTENSION_REQUESTED',
        variables: expect.objectContaining({ minutes: '60' }),
      });
      const declined = await e2e.call(
        'POST',
        `/bookings/${bookingId}/extensions/${ext.json.data.eventId}/decline`,
        { token: await client(), idempotencyKey: idemKey('decline') },
      );
      expect(declined.status).toBe(200);

      setNow(e2e, new Date(START.getTime() + 121 * MIN));
      const out = await proCall('check-out', { ...fixAt(0.04, 90), declaredFrameCount: 120 });
      expect(out.status).toBe(200);
      checkedOutAt = new Date(out.json.data.checkedOutAt);
      await drainOutbox(e2e);
      await sendDue();
      expect(lastWhatsApp()?.templateCode).toBe('CHECKED_OUT');

      const [binding] = await e2e.db.sql<{ closes_at: Date | null }[]>`
        SELECT closes_at FROM call_bindings WHERE assignment_id = ${assignmentId}`;
      expect(binding?.closes_at).toEqual(new Date(checkedOutAt.getTime() + 2 * HOUR));
      const types = (await sends()).filter((r) => r.recipient_kind === 'USER');
      expect(new Set(types.map((r) => r.template_code))).toEqual(
        new Set([
          'BOOKING_CONFIRMED',
          'PHOTOGRAPHER_ASSIGNED',
          'PHOTOGRAPHER_ON_THE_WAY',
          'CHECKED_IN',
          'EXTENSION_REQUESTED',
          'CHECKED_OUT',
        ]),
      );
    });

    it('calls still connect inside check-out + 2 h and are refused after it', async () => {
      setNow(e2e, new Date(checkedOutAt.getTime() + 119 * MIN));
      const inside = await e2e.call('POST', `/bookings/${bookingId}/call`, {
        token: await client(),
      });
      expect(inside.status).toBe(200);
      setNow(e2e, new Date(checkedOutAt.getTime() + 2 * HOUR));
      const after = await e2e.call('POST', `/bookings/${bookingId}/call`, {
        token: await client(),
      });
      expect(after.status).toBe(409);
      expect(after.json.error.code).toBe('CALL_NOT_AVAILABLE');
      const proAfter = await e2e.call('POST', `/pro/assignments/${assignmentId}/call`, {
        token: await pro(),
      });
      expect(proAfter.status).toBe(409);
    });

    it('QA passed → balance due goes at once (transactional)', async () => {
      const bookings = e2e.get(BookingsService);
      for (const to of ['UPLOADING', 'PROCESSING', 'QA', 'BALANCE_PENDING'] as const) {
        await e2e.db.sql.begin((tx) =>
          bookings.transition(tx, {
            bookingId,
            to,
            actor: { kind: 'SYSTEM', id: null },
            occurredAt: e2e.now(),
            reason: 'notifications e2e',
            ...(to === 'BALANCE_PENDING' ? { payload: { balance_due_paise: 576_725 } } : {}),
          }),
        );
      }
      await drainOutbox(e2e);
      await sendDue();
      expect(lastWhatsApp()).toMatchObject({
        templateCode: 'BALANCE_DUE',
        variables: expect.objectContaining({ amount: '₹5,767.25' }),
      });
    });

    /** The SLA module's reminder (its own tests cover when it fires). */
    const remind = async (sequence: number) => {
      await e2e.db.sql.begin((tx) =>
        appendDomainEvent(tx, {
          eventType: 'booking.balance_reminder',
          aggregateKind: 'booking',
          aggregateId: bookingId,
          occurredAt: e2e.now(),
          payload: {
            booking_id: bookingId,
            clock_id: randomUUID(),
            sequence,
            balance_paise: 576_725,
          },
        }),
      );
      await drainOutbox(e2e);
    };

    it('quiet hours: a reminder raised at 10 pm IST waits for 08:00 IST', async () => {
      setNow(e2e, new Date('2026-11-15T16:30:00.000Z')); // Sun 22:00 IST
      await remind(1);
      expect(await sendDue()).toBe(0);
      expect(await sends('BALANCE_REMINDER')).toEqual([]);
      const morning = new Date('2026-11-16T02:30:00.000Z'); // Mon 08:00 IST
      expect(
        e2e.scheduler
          .pending(JOB.NOTIFICATION_SEND)
          .filter((j) => j.at.getTime() === morning.getTime()),
      ).toHaveLength(1);
      setNow(e2e, morning);
      await sendDue();
      expect(lastWhatsApp()).toMatchObject({ templateCode: 'BALANCE_REMINDER', to: CLIENT_PHONE });
      expect((await sends('BALANCE_REMINDER')).map((r) => [r.channel, r.status])).toEqual([
        ['WHATSAPP', 'SENT'],
        ['PUSH', 'SENT'],
      ]);
    });

    it('muted: the next reminder is SKIPPED, a transactional message still goes', async () => {
      const muted = await e2e.call('POST', '/me/notification-preferences', {
        token: await client(),
        body: { muteWhatsapp: true, muteSms: true, mutePush: true },
      });
      expect(muted.json.data).toMatchObject({ whatsappOptIn: true, muteSms: true });
      setNow(e2e, new Date(e2e.now().getTime() + DAY));
      const before = whatsapp.sent.length;
      await remind(2);
      await sendDue();
      expect(whatsapp.sent.length).toBe(before);
      const reminders = await sends('BALANCE_REMINDER');
      expect(reminders.slice(2).map((r) => [r.channel, r.status, r.error_code])).toEqual([
        [null, 'SKIPPED', 'OPTED_OUT'],
      ]);

      await e2e.db.sql.begin((tx) =>
        appendDomainEvent(tx, {
          eventType: 'credit.issued',
          aggregateKind: 'client_credit',
          aggregateId: randomUUID(),
          occurredAt: e2e.now(),
          payload: {
            user_id: userId,
            booking_id: bookingId,
            amount_paise: 50_000,
            expires_at: '2027-05-14T18:29:59.000Z',
          },
        }),
      );
      await drainOutbox(e2e);
      await sendDue();
      expect(lastWhatsApp()).toMatchObject({
        templateCode: 'CREDIT_ISSUED',
        variables: { amount: '₹500', expiresOn: '14 May 2027' },
      });
      expect((await sends('CREDIT_ISSUED')).map((r) => [r.channel, r.status])).toEqual([
        ['WHATSAPP', 'SENT'],
        ['PUSH', 'SENT'],
      ]);
    });

    it('a photographer pulling out closes their call window at once', async () => {
      const other = await bookAndPay(e2e, otherUserId, new Date(e2e.now().getTime() + 5 * DAY));
      const otherAssignment = await acceptOffer(e2e, proId, other.id as string);
      const otherClient = await tokenFor(e2e, 'USER', otherUserId);
      expect(
        await e2e.db.sql`SELECT 1 FROM call_bindings WHERE assignment_id = ${otherAssignment}`,
      ).toHaveLength(1);
      const [assigned] = await e2e.db.sql<
        {
          event_id: string;
          aggregate_id: string;
          payload: Record<string, unknown>;
          occurred_at: Date;
        }[]
      >`SELECT event_id, aggregate_id, payload, occurred_at FROM domain_events
        WHERE aggregate_id = ${other.id} AND event_type = 'booking.assigned'`;
      const cancelled = await e2e.call('POST', `/pro/assignments/${otherAssignment}/cancel`, {
        token: await pro(),
        idempotencyKey: idemKey('cancel'),
        body: { reason: 'Family emergency' },
      });
      expect(cancelled.status).toBe(200);
      await drainOutbox(e2e);
      const [binding] = await e2e.db.sql<{ closed_at: Date | null }[]>`
        SELECT closed_at FROM call_bindings WHERE assignment_id = ${otherAssignment}`;
      expect(binding?.closed_at).toEqual(e2e.now());
      const refused = await e2e.call('POST', `/bookings/${other.id}/call`, { token: otherClient });
      expect(refused.status).toBe(409);
      const proRefused = await e2e.call('POST', `/pro/assignments/${otherAssignment}/call`, {
        token: await pro(),
      });
      expect(proRefused.status).toBe(409);

      // The assigned event redelivered after the re-dispatch (its first delivery failed before
      // the binding was written): no window opens for the released photographer (review M2).
      if (!assigned) throw new Error('no booking.assigned event');
      await e2e.db.sql`DELETE FROM call_bindings WHERE assignment_id = ${otherAssignment}`;
      const opener = e2e
        .get(OutboxSubscribers)
        .subscribersOf('booking.assigned')
        .find((sub) => sub.name === 'calls.binding');
      await opener?.handle({
        eventId: assigned.event_id,
        eventType: 'booking.assigned',
        aggregateKind: 'booking',
        aggregateId: assigned.aggregate_id,
        payload: assigned.payload,
        occurredAt: assigned.occurred_at,
      });
      const reopened = await e2e.db.sql`
        SELECT 1 FROM call_bindings WHERE assignment_id = ${otherAssignment}`;
      expect(reopened).toHaveLength(0);
    });

    it('no row ever holds a full phone number or push token', async () => {
      const rows = await sends();
      expect(rows.length).toBeGreaterThan(10);
      const all = JSON.stringify(rows);
      for (const secret of [CLIENT_PHONE.slice(3), PRO_PHONE.slice(3), 'clientphoneAAAA']) {
        expect(all).not.toContain(secret);
      }
      // Append-only: the application cannot rewrite history.
      await expect(e2e.db.sql`UPDATE notification_sends SET status = 'SENT'`).rejects.toThrow();
      await expect(e2e.db.sql`DELETE FROM call_logs`).rejects.toThrow();
    });
  },
);
