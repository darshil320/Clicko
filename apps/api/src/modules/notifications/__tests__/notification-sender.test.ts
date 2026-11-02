import { describe, expect, it } from 'vitest';
import type { Env } from '../../../config/env';
import type { PublishedEvent } from '../../../infra/outbox/outbox-subscribers';
import { JobRegistry } from '../../../infra/queues/job-registry';
import { JOB } from '../../../infra/queues/queue-names';
import { RecordingScheduler } from '../../../test-support/recording-scheduler';
import type { BookingContactFacts } from '../../bookings/bookings.types';
import {
  ChannelSendError,
  type NotificationSmsPort,
  type PushMessage,
  type PushPort,
  type PushReceipt,
  type TemplatedMessage,
  type WhatsAppPort,
} from '../channels/channel.ports';
import {
  ConsoleNotificationSmsAdapter,
  ConsolePushAdapter,
  ConsoleWhatsAppAdapter,
} from '../channels/console-channels';
import type { Recipient, SendRecord } from '../notifications.types';
import { DEFAULT_PREFERENCES, type RecipientPreferences } from '../pipeline/channel-plan';
import { dedupeKey } from '../pipeline/dedupe';
import type { EventContext } from '../pipeline/event-map';
import { jobFor } from '../pipeline/notification-enqueuer';
import { NotificationRetryError, NotificationSender } from '../pipeline/notification-sender';
import type { NotificationReaders } from '../pipeline/readers';
import type { NotificationSendsRepository } from '../repositories/notification-sends.repository';
import type { PreferencesRepository } from '../repositories/preferences.repository';
import type { PushTokensRepository } from '../repositories/push-tokens.repository';

const BOOKING = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '66666666-6666-4666-8666-666666666666';
const PHONE = '+919812345678';
const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaAAAA]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbBBBB]';
const NOON_IST = new Date('2026-11-14T06:30:00Z');
const TEN_PM_IST = new Date('2026-11-14T16:30:00Z');
const user: Recipient = { kind: 'USER', id: USER };

const facts = (over: Partial<BookingContactFacts> = {}): BookingContactFacts => ({
  bookingId: BOOKING,
  reference: 'CLK-1042',
  status: 'BALANCE_PENDING',
  userId: USER,
  scheduledStart: new Date('2026-11-15T11:00:00Z'),
  subjectPhone: null,
  galleryRecipient: 'BOOKER',
  ...over,
});

const event = (eventType: string, payload: Record<string, unknown> = {}): PublishedEvent => ({
  eventId: EVENT_ID,
  eventType,
  aggregateKind: 'booking',
  aggregateId: BOOKING,
  payload: { booking_id: BOOKING, ...payload },
  occurredAt: NOON_IST,
});

const CONFIRMED = event('booking.confirmed');
const DELIVERED = event('booking.delivered');
const LINK_TOKEN = 'k'.repeat(43);
const REMINDER = event('booking.balance_reminder', { balance_paise: 576_725, sequence: 1 });

/** notification_sends in memory, with the SENT-once-per-channel rule of the unique index. */
class MemorySends {
  readonly rows: SendRecord[] = [];
  async insert(_db: unknown, s: SendRecord): Promise<boolean> {
    const dup = this.rows.some(
      (r) =>
        r.status === 'SENT' &&
        s.status === 'SENT' &&
        r.dedupeKey === s.dedupeKey &&
        r.channel === s.channel,
    );
    if (dup) return false;
    this.rows.push(s);
    return true;
  }
  async outcomes(_db: unknown, key: string) {
    const mine = this.rows.filter((r) => r.dedupeKey === key);
    return {
      sentChannels: new Set(
        mine.flatMap((r) => (r.status === 'SENT' && r.channel ? [r.channel] : [])),
      ),
      skipped: mine.some((r) => r.status === 'SKIPPED'),
    };
  }
}

class FailingMessaging implements WhatsAppPort, NotificationSmsPort {
  calls = 0;
  constructor(private readonly failures: ChannelSendError[]) {}
  async sendTemplate(_m: TemplatedMessage) {
    const failure = this.failures[this.calls];
    this.calls += 1;
    if (failure) throw failure;
    return { provider: 'stub', providerMessageId: `stub-${this.calls}` };
  }
}

/** Keeps every message as the pipeline built it (text and DLT placeholders included). */
class CapturingMessaging implements WhatsAppPort, NotificationSmsPort {
  readonly sent: TemplatedMessage[] = [];
  async sendTemplate(m: TemplatedMessage) {
    this.sent.push(m);
    return { provider: 'capture', providerMessageId: `capture-${this.sent.length}` };
  }
}

class ScriptedPush implements PushPort {
  readonly sent: PushMessage[] = [];
  constructor(private readonly answer: (m: PushMessage) => PushReceipt) {}
  async send(m: PushMessage) {
    this.sent.push(m);
    return this.answer(m);
  }
}

interface Setup {
  readonly now?: Date;
  readonly prefs?: RecipientPreferences | null;
  readonly tokens?: string[];
  readonly phone?: string | null;
  readonly booking?: BookingContactFacts;
  readonly whatsapp?: WhatsAppPort;
  readonly sms?: NotificationSmsPort;
  readonly push?: PushPort;
  readonly event?: PublishedEvent | null;
  readonly linkToken?: string | null;
}

function setup(s: Setup = {}) {
  let now = s.now ?? NOON_IST;
  const sends = new MemorySends();
  const scheduler = new RecordingScheduler();
  const live = [...(s.tokens ?? [])];
  const revoked: string[] = [];
  const whatsapp = s.whatsapp ?? new ConsoleWhatsAppAdapter();
  const sms = s.sms ?? new ConsoleNotificationSmsAdapter();
  const push = s.push ?? new ConsolePushAdapter();
  const ctx = (at: Date): EventContext => ({
    now: at,
    virtualNumber: '+918047112233',
    booking: async () => s.booking ?? facts(),
    photographerName: async () => 'Meera Joshi',
    currentAssignment: async () => null,
    deliveryLinkToken: async () => s.linkToken ?? null,
    userPhone: async () => PHONE,
  });
  const readers = {
    event: async () => (s.event === undefined ? CONFIRMED : s.event),
    context: ctx,
    phoneOf: async () => (s.phone === undefined ? PHONE : s.phone),
  } as unknown as NotificationReaders;
  const preferences = {
    find: async () => (s.prefs === undefined ? null : s.prefs),
  } as unknown as PreferencesRepository;
  const tokens = {
    live: async () => live.filter((t) => !revoked.includes(t)),
    revokeTokens: async (_db: unknown, gone: readonly string[]) => {
      revoked.push(...gone);
      return gone.length;
    },
  } as unknown as PushTokensRepository;
  const sender = new NotificationSender(
    {} as never,
    () => now,
    {
      PORT: 3000,
      PUBLIC_API_URL: 'https://api.clickco.in',
      PUBLIC_WEB_URL: 'https://clickco.in',
    } as Env,
    scheduler,
    readers,
    sends as unknown as NotificationSendsRepository,
    preferences,
    tokens,
    whatsapp,
    sms,
    push,
  );
  return {
    sender,
    sends,
    scheduler,
    revoked,
    whatsapp,
    sms,
    push,
    setNow: (d: Date) => {
      now = d;
    },
  };
}

const job = (code = 'BOOKING_CONFIRMED', r: Recipient = user) => jobFor(EVENT_ID, code, r);
const key = (code = 'BOOKING_CONFIRMED') => dedupeKey(EVENT_ID, user, code);
const summary = (rows: readonly SendRecord[]) =>
  rows.map((r) => [r.channel, r.status, r.errorCode] as const);

describe('NotificationSender (ADR-0027 D2)', () => {
  it('no WhatsApp opt-in: SMS, push alongside, rows masked and keyed', async () => {
    const t = setup({ tokens: [TOKEN_A] });
    await t.sender.process(job());
    expect(summary(t.sends.rows)).toEqual([
      ['SMS', 'SENT', null],
      ['PUSH', 'SENT', null],
    ]);
    const [smsRow, pushRow] = t.sends.rows;
    expect(smsRow).toMatchObject({
      dedupeKey: key(),
      eventType: 'booking.confirmed',
      templateCode: 'BOOKING_CONFIRMED',
      templateVersion: 1,
      bookingId: BOOKING,
      destinationMasked: '******5678',
      provider: 'console-sms',
    });
    expect(pushRow?.destinationMasked).toBe('ExponentPushToken[…AAAA]');
    expect(JSON.stringify(t.sends.rows)).not.toContain('9812345678');
    const sms = t.sms as ConsoleNotificationSmsAdapter;
    expect(sms.sent[0]?.text).toBe(
      'Your Clickco booking CLK-1042 for Sun 15 Nov, 4:30 pm is confirmed. We will share your photographer once one is assigned.',
    );
    expect((t.push as ConsolePushAdapter).sent[0]).toMatchObject({
      title: 'Booking confirmed',
      data: { template: 'BOOKING_CONFIRMED', bookingId: BOOKING },
    });
  });

  it('DELIVERED links to the web delivery page, never the API or a provider (ADR-0027 D6c)', async () => {
    const sms = new CapturingMessaging();
    const t = setup({ event: DELIVERED, linkToken: LINK_TOKEN, sms, tokens: [TOKEN_A] });
    await t.sender.process(job('DELIVERED'));
    expect(summary(t.sends.rows)).toEqual([
      ['SMS', 'SENT', null],
      ['PUSH', 'SENT', null],
    ]);
    const [message] = sms.sent;
    expect(message?.text).toBe(
      `Your photos for CLK-1042 are ready: https://clickco.in/d/${LINK_TOKEN}`,
    );
    expect(message?.placeholders).toEqual({
      bookingRef: 'CLK-1042',
      link: `https://clickco.in/d/${LINK_TOKEN}`,
    });
    expect(JSON.stringify(message)).not.toContain('api.clickco.in');
    // The push (lock screen, Expo/FCM/APNs) never carries the link at all.
    expect(JSON.stringify((t.push as ConsolePushAdapter).sent)).not.toContain(LINK_TOKEN);
  });

  it('opted in: WhatsApp first, and SMS is not used when it goes', async () => {
    const t = setup({ prefs: { ...DEFAULT_PREFERENCES, whatsappOptIn: true } });
    await t.sender.process(job());
    expect(summary(t.sends.rows)).toEqual([['WHATSAPP', 'SENT', null]]);
    expect((t.sms as ConsoleNotificationSmsAdapter).sent).toEqual([]);
  });

  it('WhatsApp refused for good: falls back to SMS, no retry', async () => {
    const whatsapp = new FailingMessaging([new ChannelSendError('META_131026', false)]);
    const t = setup({ prefs: { ...DEFAULT_PREFERENCES, whatsappOptIn: true }, whatsapp });
    await t.sender.process(job());
    expect(summary(t.sends.rows)).toEqual([
      ['WHATSAPP', 'FAILED', 'META_131026'],
      ['SMS', 'SENT', null],
    ]);
  });

  it('every messaging channel down: BullMQ retries, and the retry never repeats push', async () => {
    const down = new ChannelSendError('HTTP_503', true);
    const whatsapp = new FailingMessaging([down, down]);
    const sms = new FailingMessaging([new ChannelSendError('HTTP_502', true)]);
    const t = setup({
      prefs: { ...DEFAULT_PREFERENCES, whatsappOptIn: true },
      tokens: [TOKEN_A],
      whatsapp,
      sms,
    });
    await expect(t.sender.process(job())).rejects.toBeInstanceOf(NotificationRetryError);
    await expect(t.sender.process(job())).resolves.toBeUndefined();
    expect(summary(t.sends.rows)).toEqual([
      ['WHATSAPP', 'FAILED', 'HTTP_503'],
      ['SMS', 'FAILED', 'HTTP_502'],
      ['PUSH', 'SENT', null],
      ['WHATSAPP', 'FAILED', 'HTTP_503'],
      ['SMS', 'SENT', null],
    ]);
    expect((t.push as ConsolePushAdapter).sent).toHaveLength(1);
  });

  it('a final failure everywhere is recorded and not retried', async () => {
    const sms = new FailingMessaging([new ChannelSendError('MSG91_REJECTED', false)]);
    const t = setup({ sms });
    await t.sender.process(job());
    expect(summary(t.sends.rows)).toEqual([['SMS', 'FAILED', 'MSG91_REJECTED']]);
  });

  it('a redelivered job sends nothing twice', async () => {
    const t = setup({ tokens: [TOKEN_A] });
    await t.sender.process(job());
    await t.sender.process(job());
    expect(summary(t.sends.rows)).toEqual([
      ['SMS', 'SENT', null],
      ['PUSH', 'SENT', null],
    ]);
    expect((t.sms as ConsoleNotificationSmsAdapter).sent).toHaveLength(1);
  });

  it('quiet hours: a utility reminder at 10 pm IST waits for 08:00, a confirmation does not', async () => {
    const t = setup({ now: TEN_PM_IST, event: REMINDER });
    await t.sender.process(job('BALANCE_REMINDER'));
    expect(t.sends.rows).toEqual([]);
    expect(t.scheduler.pending(JOB.NOTIFICATION_SEND)).toEqual([
      expect.objectContaining({
        at: new Date('2026-11-15T02:30:00Z'),
        jobId: `${key('BALANCE_REMINDER')}-${new Date('2026-11-15T02:30:00Z').getTime()}`,
      }),
    ]);
    t.setNow(new Date('2026-11-15T02:30:00Z'));
    const registry = new JobRegistry();
    registry.register(JOB.NOTIFICATION_SEND, { process: (d) => t.sender.process(d) });
    await t.scheduler.runDue(registry, new Date('2026-11-15T02:30:00Z'));
    expect(summary(t.sends.rows)).toEqual([['SMS', 'SENT', null]]);

    const night = setup({ now: TEN_PM_IST });
    await night.sender.process(job());
    expect(summary(night.sends.rows)).toEqual([['SMS', 'SENT', null]]);
  });

  it('muted: a utility message is SKIPPED, a transactional one still goes', async () => {
    const muted = { whatsappOptIn: false, muteWhatsapp: true, muteSms: true, mutePush: true };
    const reminder = setup({ prefs: muted, tokens: [TOKEN_A], event: REMINDER });
    await reminder.sender.process(job('BALANCE_REMINDER'));
    expect(summary(reminder.sends.rows)).toEqual([[null, 'SKIPPED', 'OPTED_OUT']]);
    await reminder.sender.process(job('BALANCE_REMINDER'));
    expect(reminder.sends.rows).toHaveLength(1);

    const confirmed = setup({ prefs: muted, tokens: [TOKEN_A] });
    await confirmed.sender.process(job());
    expect(summary(confirmed.sends.rows)).toEqual([
      ['SMS', 'SENT', null],
      ['PUSH', 'SENT', null],
    ]);
  });

  it('a reminder whose balance was paid meanwhile is skipped as no longer relevant', async () => {
    const t = setup({ event: REMINDER, booking: facts({ status: 'DELIVERED' }) });
    await t.sender.process(job('BALANCE_REMINDER'));
    expect(summary(t.sends.rows)).toEqual([[null, 'SKIPPED', 'NO_LONGER_RELEVANT']]);
  });

  it('push tokens the service says are gone are revoked', async () => {
    const push = new ScriptedPush((m) => ({
      provider: 'expo',
      providerMessageId: 'ticket-1',
      delivered: m.tokens.length - 1,
      unregistered: [TOKEN_B],
    }));
    const t = setup({ tokens: [TOKEN_A, TOKEN_B], push, phone: null });
    await t.sender.process(job());
    expect(t.revoked).toEqual([TOKEN_B]);
    expect(summary(t.sends.rows)).toEqual([['PUSH', 'SENT', null]]);

    const allGone = new ScriptedPush((m) => ({
      provider: 'expo',
      providerMessageId: null,
      delivered: 0,
      unregistered: [...m.tokens],
    }));
    const u = setup({ tokens: [TOKEN_B], push: allGone, phone: null });
    await u.sender.process(job());
    expect(summary(u.sends.rows)).toEqual([['PUSH', 'FAILED', 'DEVICE_NOT_REGISTERED']]);
    expect(u.revoked).toEqual([TOKEN_B]);
  });

  it('no phone and no device: SKIPPED for want of a destination', async () => {
    const t = setup({ phone: null });
    await t.sender.process(job());
    expect(summary(t.sends.rows)).toEqual([[null, 'SKIPPED', 'NO_DESTINATION']]);
  });

  it('variables outside their pattern are never sent', async () => {
    const t = setup({ booking: facts({ reference: 'Call me on 98123 45678' }) });
    await t.sender.process(job());
    expect(summary(t.sends.rows)).toEqual([[null, 'SKIPPED', 'INVALID_VARIABLES']]);
  });

  it('malformed jobs throw; unknown events and templates do nothing', async () => {
    const t = setup();
    await expect(t.sender.process({ eventId: 'nope' })).rejects.toThrow(/Malformed/);
    await t.sender.process(job('NOT_A_TEMPLATE'));
    await setup({ event: null }).sender.process(job());
    expect(t.sends.rows).toEqual([]);
  });
});
