import type { FetchLike } from '../../../common/http/fetch-like';

/**
 * Provider responses as recorded from each provider's documented examples (no network in tests).
 * Numbers and tokens are fakes; ids keep the providers' shapes.
 */
export const FIXTURES = {
  meta: {
    sent: {
      status: 200,
      body: {
        messaging_product: 'whatsapp',
        contacts: [{ input: '919812345678', wa_id: '919812345678' }],
        messages: [{ id: 'wamid.HBgMOTE5ODEyMzQ1Njc4FQIAERgSQjVGNDQ2QjE5OEE2NzQ4QjhFAA==' }],
      },
    },
    undeliverable: {
      status: 400,
      body: {
        error: {
          message: '(#131026) Message undeliverable to +919812345678',
          type: 'OAuthException',
          code: 131026,
          error_data: { messaging_product: 'whatsapp', details: 'Receiver is incapable' },
          fbtrace_id: 'AbCdEfGhIjK',
        },
      },
    },
    rateLimited: {
      status: 400,
      body: {
        error: {
          message: '(#130429) Rate limit hit',
          type: 'OAuthException',
          code: 130429,
          fbtrace_id: 'AbCdEfGhIjK',
        },
      },
    },
    proxyError: { status: 502, raw: '<html><body>Bad Gateway</body></html>' },
  },
  msg91: {
    sent: { status: 200, body: { message: '3763646c3058373530393831', type: 'success' } },
    rejected: {
      status: 200,
      body: { message: 'Invalid mobile number 919812345678', type: 'error' },
    },
    unauthorised: { status: 401, body: { message: 'Authentication failure', type: 'error' } },
    outage: { status: 503, raw: 'Service Unavailable' },
  },
  expo: {
    mixed: {
      status: 200,
      body: {
        data: [
          { status: 'ok', id: 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX' },
          {
            status: 'error',
            message:
              '"ExponentPushToken[gonegonegonegone]" is not a registered push notification recipient',
            details: { error: 'DeviceNotRegistered' },
          },
        ],
      },
    },
    allGone: {
      status: 200,
      body: {
        data: [
          {
            status: 'error',
            message: '"ExponentPushToken[gonegonegonegone]" is not a registered push recipient',
            details: { error: 'DeviceNotRegistered' },
          },
        ],
      },
    },
    rateExceeded: {
      status: 200,
      body: {
        data: [
          {
            status: 'error',
            message: 'Too many messages to "ExponentPushToken[aaaaaaaaaaaaaaaa]"',
            details: { error: 'MessageRateExceeded' },
          },
        ],
      },
    },
    tooManyRequests: {
      status: 429,
      body: {
        errors: [{ code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded for project' }],
      },
    },
  },
  exotel: {
    connected: {
      status: 200,
      body: {
        Call: {
          Sid: 'b6cfaf0e4f1b6a3bd8a1fdd0e2b1b9f2',
          ParentCallSid: null,
          AccountSid: 'clickco1',
          To: '09876543210',
          From: '09812345678',
          PhoneNumberSid: '08047112233',
          Status: 'in-progress',
          Direction: 'outbound-api',
        },
      },
    },
    badNumber: {
      status: 400,
      body: { RestException: { Status: 400, Message: 'From number 98123 is not valid' } },
    },
    throttled: { status: 429, body: { RestException: { Status: 429, Message: 'Too many' } } },
    statusCompleted: {
      CallSid: 'b6cfaf0e4f1b6a3bd8a1fdd0e2b1b9f2',
      EventType: 'terminal',
      Status: 'completed',
      DateCreated: '2026-11-15 12:00:01',
      DateUpdated: '2026-11-15 12:03:10',
      To: '09876543210',
      From: '09812345678',
      PhoneNumberSid: '08047112233',
      ConversationDuration: 182,
      CustomField: '9a1d2a67-1d4c-4f3e-a6a0-3b0f6c1d2e3f',
      RecordingUrl: null,
      Legs: [
        { OnCallDuration: 190, Status: 'completed' },
        { OnCallDuration: 182, Status: 'completed' },
      ],
    },
  },
} as const;

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

type Reply =
  | { readonly status: number; readonly body: unknown }
  | { readonly status: number; readonly raw: string };

/** A FetchLike that answers from the given replies in order and records every request. */
export function fixtureFetch(...replies: (Reply | Error)[]) {
  const requests: RecordedRequest[] = [];
  let next = 0;
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, body: init.body });
    const reply = replies[Math.min(next, replies.length - 1)];
    next += 1;
    if (!reply) throw new Error('fixtureFetch: no reply configured');
    if (reply instanceof Error) throw reply;
    const text = 'raw' in reply ? reply.raw : JSON.stringify(reply.body);
    return { status: reply.status, text: async () => text };
  };
  return { fetch, requests };
}
