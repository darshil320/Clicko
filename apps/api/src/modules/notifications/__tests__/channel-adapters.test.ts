import { describe, expect, it } from 'vitest';
import type { Env } from '../../../config/env';
import { ChannelSendError, type TemplatedMessage } from '../channels/channel.ports';
import { pushAdapter, smsAdapter, whatsAppAdapter } from '../channels/channel-providers';
import {
  ConsoleNotificationSmsAdapter,
  ConsolePushAdapter,
  ConsoleWhatsAppAdapter,
} from '../channels/console-channels';
import { ExpoPushAdapter } from '../channels/expo-push.adapter';
import { MetaWhatsAppAdapter, metaTemplateBody } from '../channels/meta-whatsapp.adapter';
import {
  Msg91SmsAdapter,
  parseMsg91Templates,
  SMS_TEMPLATE_CODES,
} from '../channels/msg91-sms.adapter';
import { placeholderValues, renderText, templateOf } from '../templates/templates';
import { FIXTURES, fixtureFetch } from './provider-fixtures';

const PHONE = '+919812345678';
const TOKEN = 'b'.repeat(43);
/** The website's origin (PUBLIC_WEB_URL): messages link to its delivery page (ADR-0027 D6c). */
const LINK_BASE = 'https://clickco.in';

function message(code: string, variables: Record<string, string>): TemplatedMessage {
  const template = templateOf(code);
  if (!template) throw new Error(`no template ${code}`);
  return {
    to: PHONE,
    template,
    variables,
    text: renderText(template, variables, LINK_BASE),
    placeholders: placeholderValues(template, variables, LINK_BASE),
  };
}

const delivered = () => message('DELIVERED', { bookingRef: 'CLK-1001', linkToken: TOKEN });
const confirmed = () =>
  message('BOOKING_CONFIRMED', { bookingRef: 'CLK-1001', when: 'Sat 14 Nov, 4:30 pm' });

/** What an adapter error may say: a code, never the number, token or provider text. */
async function sendError(p: Promise<unknown>): Promise<ChannelSendError> {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ChannelSendError);
  const e = error as ChannelSendError;
  expect(e.message).not.toMatch(/9812345678|undeliverable|Invalid mobile/i);
  return e;
}

const allTemplates = () =>
  JSON.stringify(
    Object.fromEntries(
      SMS_TEMPLATE_CODES.map((c, i) => [
        c,
        {
          flowId: `65f0a1b2c3d4e5f6a7b8c9${String(i).padStart(2, '0')}`,
          dltTemplateId: '1107172000000000001',
        },
      ]),
    ),
  );

describe('Meta WhatsApp Cloud API adapter', () => {
  const config = { phoneNumberId: '109876543210', accessToken: 'EAAG-test', graphVersion: 'v21.0' };

  it('sends the approved template with body parameters and the URL button suffix', async () => {
    const { fetch, requests } = fixtureFetch(FIXTURES.meta.sent);
    const receipt = await new MetaWhatsAppAdapter(config, fetch).sendTemplate(delivered());
    expect(receipt).toEqual({
      provider: 'meta-whatsapp',
      providerMessageId: 'wamid.HBgMOTE5ODEyMzQ1Njc4FQIAERgSQjVGNDQ2QjE5OEE2NzQ4QjhFAA==',
    });
    const [req] = requests;
    expect(req?.url).toBe('https://graph.facebook.com/v21.0/109876543210/messages');
    expect(req?.headers.authorization).toBe('Bearer EAAG-test');
    expect(JSON.parse(req?.body ?? '{}')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919812345678',
      type: 'template',
      template: {
        name: 'photos_delivered_v1',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'CLK-1001' }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: TOKEN }],
          },
        ],
      },
    });
  });

  it('orders body parameters as approved and has no button without one', () => {
    const body = metaTemplateBody(confirmed()) as { template: { components: unknown[] } };
    expect(body.template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'CLK-1001' },
          { type: 'text', text: 'Sat 14 Nov, 4:30 pm' },
        ],
      },
    ]);
  });

  it('an accepted message without a usable id is still sent (id stored as null, never retried)', async () => {
    const odd = { status: 200, body: { messages: [{ id: 'wamid with spaces <b>' }] } };
    const receipt = await new MetaWhatsAppAdapter(config, fixtureFetch(odd).fetch).sendTemplate(
      confirmed(),
    );
    expect(receipt).toEqual({ provider: 'meta-whatsapp', providerMessageId: null });
  });

  it('maps errors to codes: undeliverable is final, rate limits and 5xx retry', async () => {
    const send = (reply: Parameters<typeof fixtureFetch>[0]) =>
      new MetaWhatsAppAdapter(config, fixtureFetch(reply).fetch).sendTemplate(confirmed());
    expect(await sendError(send(FIXTURES.meta.undeliverable))).toMatchObject({
      code: 'META_131026',
      retryable: false,
    });
    expect(await sendError(send(FIXTURES.meta.rateLimited))).toMatchObject({
      code: 'META_130429',
      retryable: true,
    });
    expect(await sendError(send(FIXTURES.meta.proxyError))).toMatchObject({
      code: 'HTTP_502',
      retryable: true,
    });
    expect(await sendError(send(new TypeError('fetch failed')))).toMatchObject({
      code: 'NETWORK',
      retryable: true,
    });
  });
});

describe('MSG91 Flow API adapter (DLT SMS)', () => {
  const config = () => ({
    authKey: 'msg91-auth-key-test',
    senderId: 'CLICKO',
    templates: parseMsg91Templates(allTemplates()),
  });

  it('sends the registered flow with the template placeholders and no short URL', async () => {
    const { fetch, requests } = fixtureFetch(FIXTURES.msg91.sent);
    const receipt = await new Msg91SmsAdapter(config(), fetch).sendTemplate(delivered());
    expect(receipt).toEqual({ provider: 'msg91', providerMessageId: '3763646c3058373530393831' });
    const [req] = requests;
    expect(req?.url).toBe('https://control.msg91.com/api/v5/flow');
    expect(req?.headers.authkey).toBe('msg91-auth-key-test');
    const body = JSON.parse(req?.body ?? '{}');
    expect(body).toEqual({
      template_id: config().templates.DELIVERED?.flowId,
      sender: 'CLICKO',
      short_url: '0',
      recipients: [
        { mobiles: '919812345678', bookingRef: 'CLK-1001', link: `${LINK_BASE}/d/${TOKEN}` },
      ],
    });
  });

  it('a request id that is not an id is stored as null', async () => {
    const odd = { status: 200, body: { type: 'success', message: 'Sent to 919812345678!' } };
    const receipt = await new Msg91SmsAdapter(config(), fixtureFetch(odd).fetch).sendTemplate(
      confirmed(),
    );
    expect(receipt).toEqual({ provider: 'msg91', providerMessageId: null });
  });

  it('a 200 with type "error" is a final rejection; 5xx retries', async () => {
    const send = (reply: Parameters<typeof fixtureFetch>[0]) =>
      new Msg91SmsAdapter(config(), fixtureFetch(reply).fetch).sendTemplate(confirmed());
    expect(await sendError(send(FIXTURES.msg91.rejected))).toMatchObject({
      code: 'MSG91_REJECTED',
      retryable: false,
    });
    expect(await sendError(send(FIXTURES.msg91.unauthorised))).toMatchObject({
      code: 'HTTP_401',
      retryable: false,
    });
    expect(await sendError(send(FIXTURES.msg91.outage))).toMatchObject({
      code: 'HTTP_503',
      retryable: true,
    });
  });

  it('MSG91_TEMPLATES is checked against the catalogue at boot', () => {
    expect(() => parseMsg91Templates('not json')).toThrow(/not valid JSON/);
    expect(() => parseMsg91Templates('{}')).toThrow(/missing SMS templates: BOOKING_CONFIRMED/);
    const withUnknown = {
      ...JSON.parse(allTemplates()),
      MARKETING_BLAST: JSON.parse(allTemplates()).DELIVERED,
    };
    expect(() => parseMsg91Templates(JSON.stringify(withUnknown))).toThrow(
      /unknown templates: MARKETING_BLAST/,
    );
    const badId = { ...JSON.parse(allTemplates()), DELIVERED: { flowId: 'x', dltTemplateId: '1' } };
    expect(() => parseMsg91Templates(JSON.stringify(badId))).toThrow(/DELIVERED/);
    // PRO_NEW_OFFER is push only: it needs no DLT template.
    expect(SMS_TEMPLATE_CODES).not.toContain('PRO_NEW_OFFER');
  });
});

describe('Expo push adapter', () => {
  const live = 'ExponentPushToken[aaaaaaaaaaaaaaaa]';
  const gone = 'ExponentPushToken[gonegonegonegone]';
  const push = { title: 'Booking confirmed', body: 'Confirmed', data: { bookingId: 'b-1' } };

  it('sends one message per token and reports DeviceNotRegistered tokens', async () => {
    const { fetch, requests } = fixtureFetch(FIXTURES.expo.mixed);
    const receipt = await new ExpoPushAdapter('expo-access-token-test', fetch).send({
      ...push,
      tokens: [live, gone],
    });
    expect(receipt).toEqual({
      provider: 'expo',
      providerMessageId: 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
      delivered: 1,
      unregistered: [gone],
    });
    const [req] = requests;
    expect(req?.url).toBe('https://exp.host/--/api/v2/push/send');
    expect(req?.headers.authorization).toBe('Bearer expo-access-token-test');
    expect(JSON.parse(req?.body ?? '[]')).toEqual([
      { to: live, ...push, sound: 'default', priority: 'high' },
      { to: gone, ...push, sound: 'default', priority: 'high' },
    ]);
  });

  it('every token gone: nothing delivered, all to revoke (not an error)', async () => {
    const receipt = await new ExpoPushAdapter(null, fixtureFetch(FIXTURES.expo.allGone).fetch).send(
      { ...push, tokens: [gone] },
    );
    expect(receipt).toMatchObject({ delivered: 0, unregistered: [gone] });
  });

  it('maps ticket and request errors to codes', async () => {
    const send = (reply: Parameters<typeof fixtureFetch>[0]) =>
      new ExpoPushAdapter(null, fixtureFetch(reply).fetch).send({ ...push, tokens: [live] });
    expect(await sendError(send(FIXTURES.expo.rateExceeded))).toMatchObject({
      code: 'EXPO_MessageRateExceeded',
      retryable: true,
    });
    expect(await sendError(send(FIXTURES.expo.tooManyRequests))).toMatchObject({
      code: 'EXPO_TOO_MANY_REQUESTS',
      retryable: true,
    });
  });

  it('sends without an Authorization header when no access token is set', async () => {
    const { fetch, requests } = fixtureFetch(FIXTURES.expo.allGone);
    await new ExpoPushAdapter(null, fetch).send({ ...push, tokens: [gone] });
    expect(requests[0]?.headers.authorization).toBeUndefined();
  });
});

describe('console adapters and selection by environment', () => {
  it('record what would be sent', async () => {
    const wa = new ConsoleWhatsAppAdapter();
    const sms = new ConsoleNotificationSmsAdapter();
    const pushes = new ConsolePushAdapter();
    await wa.sendTemplate(confirmed());
    await sms.sendTemplate(delivered());
    await pushes.send({
      tokens: ['ExponentPushToken[aaaaaaaaaaaaaaaa]'],
      title: 't',
      body: 'b',
      data: {},
    });
    expect(wa.sent).toEqual([
      expect.objectContaining({
        channel: 'WHATSAPP',
        to: PHONE,
        templateCode: 'BOOKING_CONFIRMED',
      }),
    ]);
    expect(sms.sent[0]?.text).toContain(`/d/${TOKEN}`);
    expect(pushes.sent).toHaveLength(1);
    wa.clear();
    expect(wa.sent).toEqual([]);
  });

  it('the real adapters are chosen by env; MSG91 templates fail the boot when incomplete', () => {
    const { fetch } = fixtureFetch(FIXTURES.meta.sent);
    const base = { PORT: 0 } as unknown as Env;
    expect(whatsAppAdapter({ ...base, WHATSAPP_ADAPTER: 'console' } as Env, fetch)).toBeInstanceOf(
      ConsoleWhatsAppAdapter,
    );
    expect(
      whatsAppAdapter(
        {
          ...base,
          WHATSAPP_ADAPTER: 'meta',
          WHATSAPP_PHONE_NUMBER_ID: '109876543210',
          WHATSAPP_ACCESS_TOKEN: 'EAAG-test-token-0123456789',
          WHATSAPP_GRAPH_VERSION: 'v21.0',
        } as Env,
        fetch,
      ),
    ).toBeInstanceOf(MetaWhatsAppAdapter);
    expect(pushAdapter({ ...base, PUSH_ADAPTER: 'expo' } as Env, fetch)).toBeInstanceOf(
      ExpoPushAdapter,
    );
    const msg91 = {
      ...base,
      NOTIFY_SMS_ADAPTER: 'msg91',
      MSG91_AUTH_KEY: 'msg91-auth-key-test',
      MSG91_SENDER_ID: 'CLICKO',
      MSG91_DLT_ENTITY_ID: '1101000000000000001',
    } as Env;
    expect(smsAdapter({ ...msg91, MSG91_TEMPLATES: allTemplates() } as Env, fetch)).toBeInstanceOf(
      Msg91SmsAdapter,
    );
    expect(() => smsAdapter({ ...msg91, MSG91_TEMPLATES: '{}' } as Env, fetch)).toThrow(/missing/);
  });
});
