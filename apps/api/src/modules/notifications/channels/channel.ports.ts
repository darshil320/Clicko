import type { AnyTemplate } from '../templates/templates';

/**
 * The notification channels (ADR-0027 D1). Each is a port with a console adapter (development and
 * tests: records what would be sent) and a real adapter written to the provider's documented API.
 * env.ts refuses the console adapters in staging and production.
 *
 * Adapters throw ChannelSendError on failure: a short code and whether a retry may succeed — never
 * the destination, a token or the provider's raw message (which can echo the number).
 */
export class ChannelSendError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`Channel send failed: ${code}`);
    this.name = 'ChannelSendError';
  }
}

export interface TemplatedMessage {
  /** E.164 (+91…). */
  readonly to: string;
  readonly template: AnyTemplate;
  /** Validated against template.variables. */
  readonly variables: Readonly<Record<string, string>>;
  /** The rendered text (what the approved template says with these variables). */
  readonly text: string;
  /** The value of each `{name}` in the text (the full link for `{link}`): the DLT SMS fill. */
  readonly placeholders: Readonly<Record<string, string>>;
}

export interface SendReceipt {
  readonly provider: string;
  readonly providerMessageId: string | null;
}

/** WhatsApp Business: approved templates only (business-initiated messages). */
export interface WhatsAppPort {
  sendTemplate(message: TemplatedMessage): Promise<SendReceipt>;
}
export const WHATSAPP_PORT = Symbol('WHATSAPP_PORT');

/**
 * Lifecycle SMS on DLT-registered templates. The OTP SMS keeps auth's own SmsPort (it has its own
 * DLT template and queue); a provider adapter can implement both.
 */
export interface NotificationSmsPort {
  sendTemplate(message: TemplatedMessage): Promise<SendReceipt>;
}
export const NOTIFICATION_SMS_PORT = Symbol('NOTIFICATION_SMS_PORT');

export interface PushMessage {
  readonly tokens: readonly string[];
  readonly title: string;
  readonly body: string;
  /** Deep-link data for the app; ids only. */
  readonly data: Readonly<Record<string, string>>;
}

export interface PushReceipt extends SendReceipt {
  readonly delivered: number;
  /** Tokens the push service says are gone (uninstalled): revoke them. */
  readonly unregistered: readonly string[];
}

/** Expo push service (→ FCM / APNs). */
export interface PushPort {
  send(message: PushMessage): Promise<PushReceipt>;
}
export const PUSH_PORT = Symbol('PUSH_PORT');
