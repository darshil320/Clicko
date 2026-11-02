import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../../common/clock';
import { ENV, type Env } from '../../../config/env';
import { SQL } from '../../../infra/db/db.module';
import type { JobData } from '../../../infra/queues/job-registry';
import { JOB_SCHEDULER, type JobScheduler } from '../../../infra/queues/job-scheduler';
import { JOB } from '../../../infra/queues/queue-names';
import {
  ChannelSendError,
  NOTIFICATION_SMS_PORT,
  type NotificationSmsPort,
  PUSH_PORT,
  type PushPort,
  WHATSAPP_PORT,
  type WhatsAppPort,
} from '../channels/channel.ports';
import { maskPhone, maskPushToken } from '../masking';
import {
  type AccountRef,
  isAccount,
  type Recipient,
  type SendRecord,
  type SkipReason,
} from '../notifications.types';
import {
  NotificationSendsRepository,
  type SendOutcomes,
} from '../repositories/notification-sends.repository';
import { PreferencesRepository } from '../repositories/preferences.repository';
import { PushTokensRepository } from '../repositories/push-tokens.repository';
import {
  type AnyTemplate,
  placeholderValues,
  renderPushText,
  renderText,
  TemplateVariablesError,
  templateOf,
  validateVariables,
} from '../templates/templates';
import { DEFAULT_PREFERENCES, planChannels, sendableAt } from './channel-plan';
import { dedupeKey } from './dedupe';
import { type EventMapping, mappingFor, type NotificationIntent } from './event-map';
import { NotificationJob } from './notification-enqueuer';
import { NotificationReaders } from './readers';

/** Thrown so BullMQ retries the job (attempts and backoff in queue-names). Codes only. */
export class NotificationRetryError extends Error {
  constructor(readonly codes: readonly string[]) {
    super(`Notification will be retried: ${codes.join(', ')}`);
    this.name = 'NotificationRetryError';
  }
}

/** What one send is about; each attempt becomes a notification_sends row. */
type Base = Omit<
  SendRecord,
  'channel' | 'destinationMasked' | 'status' | 'provider' | 'providerMessageId' | 'errorCode' | 'at'
>;

interface Message {
  readonly def: AnyTemplate;
  readonly variables: Readonly<Record<string, string>>;
  readonly text: string;
  /** Never a delivery link: lock screens and push relays (renderPushText). */
  readonly pushText: string;
  readonly placeholders: Readonly<Record<string, string>>;
  readonly data: Readonly<Record<string, string>>;
}

const sameRecipient = (a: Recipient, b: Recipient): boolean => a.kind === b.kind && a.id === b.id;

const asSendError = (error: unknown): ChannelSendError =>
  error instanceof ChannelSendError ? error : new ChannelSendError('UNEXPECTED', true);

/**
 * The queue side of the pipeline (ADR-0027 D2): one recipient's message for one event. Reads the
 * event, resolves fresh variables, preferences and push tokens, plans the channels (quiet hours,
 * opt-in, mutes), tries WhatsApp then SMS, sends push alongside, and records every attempt in
 * notification_sends. A redelivery or retry never repeats a channel that already went (SENT rows
 * per dedupe key; the unique index is the backstop). Retryable failures throw for BullMQ.
 * Destinations are masked in every row and log line.
 */
@Injectable()
export class NotificationSender {
  private readonly logger = new Logger(NotificationSender.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(JOB_SCHEDULER) private readonly scheduler: JobScheduler,
    @Inject(NotificationReaders) private readonly readers: NotificationReaders,
    @Inject(NotificationSendsRepository) private readonly sends: NotificationSendsRepository,
    @Inject(PreferencesRepository) private readonly preferences: PreferencesRepository,
    @Inject(PushTokensRepository) private readonly tokens: PushTokensRepository,
    @Inject(WHATSAPP_PORT) private readonly whatsapp: WhatsAppPort,
    @Inject(NOTIFICATION_SMS_PORT) private readonly sms: NotificationSmsPort,
    @Inject(PUSH_PORT) private readonly push: PushPort,
  ) {}

  /**
   * Where `{link}` points: Clickco's own delivery page, `<PUBLIC_WEB_URL>/d/<token>` (ADR-0027
   * D6c), which lists the files from the API's /d/<token> route. Never a provider URL.
   */
  private get linkBase(): string {
    return this.env.PUBLIC_WEB_URL.replace(/\/+$/, '');
  }

  async process(data: JobData): Promise<void> {
    const parsed = NotificationJob.safeParse(data);
    if (!parsed.success) throw new Error('Malformed notification job');
    const job = parsed.data;
    const recipient: Recipient = { kind: job.recipientKind, id: job.recipientId };
    const event = await this.readers.event(job.eventId);
    const mapping = event ? mappingFor(event.eventType, job.templateCode) : null;
    const def = templateOf(job.templateCode);
    if (!event || !mapping || !def) {
      this.logger.warn(`Notification job for an unknown event or template (${job.templateCode})`);
      return;
    }
    const base: Base = {
      dedupeKey: dedupeKey(event.eventId, recipient, def.code),
      eventId: event.eventId,
      eventType: event.eventType,
      templateCode: def.code,
      templateVersion: def.version,
      recipient,
      bookingId: null,
    };
    const done = await this.sends.outcomes(this.sql, base.dedupeKey);
    if (done.skipped) return;

    const now = this.clock();
    const at = sendableAt(def.category, now);
    if (at > now) {
      // A retry that landed in quiet hours waits for 08:00 IST like a fresh message.
      await this.scheduler.runAt(
        JOB.NOTIFICATION_SEND,
        data,
        at,
        `${base.dedupeKey}-${at.getTime()}`,
      );
      return;
    }
    const intent = await this.intentFor(mapping, event, recipient, now);
    if (!intent) return this.skip(base, 'NO_LONGER_RELEVANT', done);
    const message = this.message(def, intent);
    if (!message)
      return this.skip({ ...base, bookingId: intent.bookingId }, 'INVALID_VARIABLES', done);
    await this.deliver({ ...base, bookingId: intent.bookingId }, message, done);
  }

  private async intentFor(
    mapping: EventMapping,
    event: Parameters<EventMapping['resolve']>[0],
    recipient: Recipient,
    now: Date,
  ): Promise<NotificationIntent | null> {
    const intents = await mapping.resolve(event, this.readers.context(now));
    return intents.find((i) => sameRecipient(i.recipient, recipient)) ?? null;
  }

  private message(def: AnyTemplate, intent: NotificationIntent): Message | null {
    try {
      const variables = validateVariables(def, intent.variables);
      return {
        def,
        variables,
        text: renderText(def, variables, this.linkBase),
        pushText: renderPushText(def, variables),
        placeholders: placeholderValues(def, variables, this.linkBase),
        data: intent.data,
      };
    } catch (error) {
      if (!(error instanceof TemplateVariablesError)) throw error;
      this.logger.warn(`${error.message}: not sent`);
      return null;
    }
  }

  private async deliver(base: Base, m: Message, done: SendOutcomes): Promise<void> {
    const r = base.recipient;
    const [phone, prefs, pushTokens] = await Promise.all([
      this.readers.phoneOf(r),
      isAccount(r) ? this.preferences.find(this.sql, r) : Promise.resolve(null),
      isAccount(r) ? this.tokens.live(this.sql, r) : Promise.resolve([] as string[]),
    ]);
    const plan = planChannels(m.def, prefs ?? DEFAULT_PREFERENCES, pushTokens.length);
    const messaging = phone ? plan.messaging : [];
    if (messaging.length === 0 && !plan.push) {
      return this.skip(base, plan.skipReason ?? 'NO_DESTINATION', done);
    }
    const failures: ChannelSendError[] = [];
    const messagingDone = done.sentChannels.has('WHATSAPP') || done.sentChannels.has('SMS');
    if (phone && messaging.length > 0 && !messagingDone) {
      failures.push(...(await this.sendMessaging(base, messaging, phone, m)));
    }
    if (plan.push && isAccount(r) && !done.sentChannels.has('PUSH')) {
      failures.push(...(await this.sendPush(base, r, pushTokens, m)));
    }
    const retryable = failures.filter((f) => f.retryable).map((f) => f.code);
    if (retryable.length > 0) throw new NotificationRetryError(retryable);
  }

  /** WhatsApp first, SMS as the fallback; the first success ends it (earlier failures moot). */
  private async sendMessaging(
    base: Base,
    channels: readonly ('WHATSAPP' | 'SMS')[],
    phone: string,
    m: Message,
  ): Promise<ChannelSendError[]> {
    const failures: ChannelSendError[] = [];
    for (const channel of channels) {
      const port = channel === 'WHATSAPP' ? this.whatsapp : this.sms;
      try {
        const receipt = await port.sendTemplate({
          to: phone,
          template: m.def,
          variables: m.variables,
          text: m.text,
          placeholders: m.placeholders,
        });
        await this.record(base, channel, maskPhone(phone), 'SENT', receipt);
        return [];
      } catch (error) {
        const failure = asSendError(error);
        this.logger.warn(`${m.def.code} ${channel} failed: ${failure.code}`);
        await this.record(base, channel, maskPhone(phone), 'FAILED', null, failure.code);
        failures.push(failure);
      }
    }
    return failures;
  }

  private async sendPush(
    base: Base,
    owner: AccountRef,
    pushTokens: readonly string[],
    m: Message,
  ): Promise<ChannelSendError[]> {
    const shown = maskPushToken(pushTokens[0] ?? '');
    try {
      const receipt = await this.push.send({
        tokens: pushTokens,
        title: m.def.title,
        body: m.pushText,
        data: m.data,
      });
      if (receipt.unregistered.length > 0) {
        await this.tokens.revokeTokens(this.sql, receipt.unregistered, this.clock());
        this.logger.log(`Revoked ${receipt.unregistered.length} push token(s) of a ${owner.kind}`);
      }
      if (receipt.delivered > 0) {
        const live = pushTokens.find((t) => !receipt.unregistered.includes(t));
        await this.record(base, 'PUSH', maskPushToken(live ?? ''), 'SENT', receipt);
      } else {
        await this.record(base, 'PUSH', shown, 'FAILED', receipt, 'DEVICE_NOT_REGISTERED');
      }
      return [];
    } catch (error) {
      const failure = asSendError(error);
      this.logger.warn(`${m.def.code} PUSH failed: ${failure.code}`);
      await this.record(base, 'PUSH', shown, 'FAILED', null, failure.code);
      return [failure];
    }
  }

  private async record(
    base: Base,
    channel: 'WHATSAPP' | 'SMS' | 'PUSH',
    destinationMasked: string,
    status: 'SENT' | 'FAILED',
    receipt: { readonly provider: string; readonly providerMessageId: string | null } | null,
    errorCode: string | null = null,
  ): Promise<void> {
    await this.sends.insert(this.sql, {
      ...base,
      channel,
      destinationMasked,
      status,
      provider: receipt?.provider ?? null,
      providerMessageId: receipt?.providerMessageId ?? null,
      errorCode,
      at: this.clock(),
    });
  }

  /** Nothing goes to this recipient: one SKIPPED row (unless something already went). */
  private async skip(base: Base, reason: SkipReason, done: SendOutcomes): Promise<void> {
    if (done.sentChannels.size > 0) return;
    await this.sends.insert(this.sql, {
      ...base,
      channel: null,
      destinationMasked: null,
      status: 'SKIPPED',
      provider: null,
      providerMessageId: null,
      errorCode: reason,
      at: this.clock(),
    });
  }
}
