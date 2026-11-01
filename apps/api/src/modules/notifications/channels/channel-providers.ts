import type { Provider } from '@nestjs/common';
import { type FetchLike, globalFetch, HTTP_FETCH } from '../../../common/http/fetch-like';
import { ENV, type Env } from '../../../config/env';
import { NOTIFICATION_SMS_PORT, PUSH_PORT, WHATSAPP_PORT } from './channel.ports';
import {
  ConsoleNotificationSmsAdapter,
  ConsolePushAdapter,
  ConsoleWhatsAppAdapter,
} from './console-channels';
import { ExpoPushAdapter } from './expo-push.adapter';
import { MetaWhatsAppAdapter } from './meta-whatsapp.adapter';
import { Msg91SmsAdapter, parseMsg91Templates } from './msg91-sms.adapter';

/** env.ts guarantees the credentials whenever a real adapter is selected; this re-checks. */
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required by the selected notification adapter`);
  return value;
}

export function whatsAppAdapter(env: Env, fetch: FetchLike) {
  if (env.WHATSAPP_ADAPTER === 'console') return new ConsoleWhatsAppAdapter();
  return new MetaWhatsAppAdapter(
    {
      phoneNumberId: required(env.WHATSAPP_PHONE_NUMBER_ID, 'WHATSAPP_PHONE_NUMBER_ID'),
      accessToken: required(env.WHATSAPP_ACCESS_TOKEN, 'WHATSAPP_ACCESS_TOKEN'),
      graphVersion: env.WHATSAPP_GRAPH_VERSION,
    },
    fetch,
  );
}

/** MSG91_TEMPLATES is validated against the template catalogue here: a gap fails the boot. */
export function smsAdapter(env: Env, fetch: FetchLike) {
  if (env.NOTIFY_SMS_ADAPTER === 'console') return new ConsoleNotificationSmsAdapter();
  return new Msg91SmsAdapter(
    {
      authKey: required(env.MSG91_AUTH_KEY, 'MSG91_AUTH_KEY'),
      senderId: required(env.MSG91_SENDER_ID, 'MSG91_SENDER_ID'),
      templates: parseMsg91Templates(required(env.MSG91_TEMPLATES, 'MSG91_TEMPLATES')),
    },
    fetch,
  );
}

export function pushAdapter(env: Env, fetch: FetchLike) {
  if (env.PUSH_ADAPTER === 'console') return new ConsolePushAdapter();
  return new ExpoPushAdapter(env.EXPO_ACCESS_TOKEN ?? null, fetch);
}

/** The channel ports by environment (ADR-0027 D1); tests override HTTP_FETCH or a port. */
export const CHANNEL_PROVIDERS: Provider[] = [
  { provide: HTTP_FETCH, useValue: globalFetch },
  { provide: WHATSAPP_PORT, inject: [ENV, HTTP_FETCH], useFactory: whatsAppAdapter },
  { provide: NOTIFICATION_SMS_PORT, inject: [ENV, HTTP_FETCH], useFactory: smsAdapter },
  { provide: PUSH_PORT, inject: [ENV, HTTP_FETCH], useFactory: pushAdapter },
];
