import { Logger } from '@nestjs/common';
import { maskPhone, maskPushToken } from '../masking';
import type {
  NotificationSmsPort,
  PushMessage,
  PushPort,
  PushReceipt,
  SendReceipt,
  TemplatedMessage,
  WhatsAppPort,
} from './channel.ports';

/** How many sends a console adapter remembers (oldest dropped first). */
const MAX_REMEMBERED = 200;

export interface ConsoleSend {
  readonly channel: 'WHATSAPP' | 'SMS';
  readonly to: string;
  readonly templateCode: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly text: string;
}

export interface ConsolePush {
  readonly tokens: readonly string[];
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, string>>;
}

const remember = <T>(list: readonly T[], item: T): readonly T[] =>
  [...list, item].slice(-MAX_REMEMBERED);

/**
 * DEVELOPMENT AND TEST ONLY (ADR-0027 D1): records what would be sent and logs a masked line.
 * env.ts refuses console adapters in staging and production. Tests read `sent` to assert on the
 * pipeline; the log never shows a full number or token.
 */
abstract class ConsoleMessaging {
  private readonly logger: Logger;
  private log: readonly ConsoleSend[] = [];
  private seq = 0;

  constructor(
    private readonly channel: 'WHATSAPP' | 'SMS',
    private readonly provider: string,
  ) {
    this.logger = new Logger(provider);
  }

  get sent(): readonly ConsoleSend[] {
    return this.log;
  }

  clear(): void {
    this.log = [];
  }

  async sendTemplate(m: TemplatedMessage): Promise<SendReceipt> {
    this.logger.log(`[dev only] ${this.channel} ${m.template.code} → ${maskPhone(m.to)}`);
    this.log = remember(this.log, {
      channel: this.channel,
      to: m.to,
      templateCode: m.template.code,
      variables: m.variables,
      text: m.text,
    });
    this.seq += 1;
    return { provider: this.provider, providerMessageId: `${this.provider}-${this.seq}` };
  }
}

export class ConsoleWhatsAppAdapter extends ConsoleMessaging implements WhatsAppPort {
  constructor() {
    super('WHATSAPP', 'console-whatsapp');
  }
}

export class ConsoleNotificationSmsAdapter extends ConsoleMessaging implements NotificationSmsPort {
  constructor() {
    super('SMS', 'console-sms');
  }
}

export class ConsolePushAdapter implements PushPort {
  private readonly logger = new Logger('console-push');
  private log: readonly ConsolePush[] = [];
  private seq = 0;

  get sent(): readonly ConsolePush[] {
    return this.log;
  }

  clear(): void {
    this.log = [];
  }

  async send(m: PushMessage): Promise<PushReceipt> {
    this.logger.log(`[dev only] PUSH "${m.title}" → ${m.tokens.map(maskPushToken).join(', ')}`);
    this.log = remember(this.log, { tokens: m.tokens, title: m.title, body: m.body, data: m.data });
    this.seq += 1;
    return {
      provider: 'console-push',
      providerMessageId: `console-push-${this.seq}`,
      delivered: m.tokens.length,
      unregistered: [],
    };
  }
}
