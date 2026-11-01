import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../config/env';
import { FIXTURES, fixtureFetch } from '../../notifications/__tests__/provider-fixtures';
import { ConsoleCallsAdapter } from '../adapters/console-calls.adapter';
import { ExotelCallsAdapter, parseExotelStatus } from '../adapters/exotel-calls.adapter';
import { secretMatches } from '../call.controllers';
import { CALLS_CONFIG } from '../calls.config';
import { callsAdapter } from '../calls.module';
import { CallConnectError } from '../calls.port';
import { isOpen } from '../repositories/call-bindings.repository';

const CONFIG = {
  accountSid: 'clickco1',
  apiKey: 'exotel-key-test',
  apiToken: 'exotel-token-test',
  host: 'api.in.exotel.com',
  callerId: '08047112233',
};
const REQUEST = {
  from: '+919812345678',
  to: '+919876543210',
  callId: '9a1d2a67-1d4c-4f3e-a6a0-3b0f6c1d2e3f',
  statusCallbackUrl: 'https://api.clickco.in/webhooks/exotel/call-status/s3cr3t',
  timeLimitSeconds: 1800,
};

async function connectError(p: Promise<unknown>): Promise<CallConnectError> {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CallConnectError);
  expect((error as Error).message).not.toMatch(/98123|not valid/);
  return error as CallConnectError;
}

describe('Exotel connect-two-numbers adapter (ADR-0027 D3)', () => {
  it('rings From first, bridges To, both see the ExoPhone; basic auth in a header', async () => {
    const { fetch, requests } = fixtureFetch(FIXTURES.exotel.connected);
    const adapter = new ExotelCallsAdapter(CONFIG, fetch);
    expect(adapter.virtualNumber).toBe('08047112233');
    expect(await adapter.connect(REQUEST)).toEqual({
      provider: 'exotel',
      providerCallId: 'b6cfaf0e4f1b6a3bd8a1fdd0e2b1b9f2',
    });
    const [req] = requests;
    expect(req?.url).toBe('https://api.in.exotel.com/v1/Accounts/clickco1/Calls/connect.json');
    expect(req?.url).not.toContain('exotel-token-test');
    expect(req?.headers.authorization).toBe(
      `Basic ${Buffer.from('exotel-key-test:exotel-token-test').toString('base64')}`,
    );
    expect(req?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(req?.body ?? ''))).toEqual({
      From: '+919812345678',
      To: '+919876543210',
      CallerId: '08047112233',
      TimeLimit: '1800',
      CustomField: REQUEST.callId,
      StatusCallback: REQUEST.statusCallbackUrl,
      'StatusCallbackEvents[0]': 'terminal',
      StatusCallbackContentType: 'application/json',
    });
  });

  it('leaves the status callback out when none is configured', async () => {
    const { fetch, requests } = fixtureFetch(FIXTURES.exotel.connected);
    await new ExotelCallsAdapter(CONFIG, fetch).connect({ ...REQUEST, statusCallbackUrl: null });
    expect(new URLSearchParams(requests[0]?.body ?? '').has('StatusCallback')).toBe(false);
  });

  it('maps errors to codes without the provider text', async () => {
    const connect = (reply: Parameters<typeof fixtureFetch>[0]) =>
      new ExotelCallsAdapter(CONFIG, fixtureFetch(reply).fetch).connect(REQUEST);
    expect(await connectError(connect(FIXTURES.exotel.badNumber))).toMatchObject({
      code: 'HTTP_400',
      retryable: false,
    });
    expect(await connectError(connect(FIXTURES.exotel.throttled))).toMatchObject({
      code: 'HTTP_429',
      retryable: true,
    });
    expect(await connectError(connect(new TypeError('fetch failed')))).toMatchObject({
      code: 'NETWORK',
    });
    // Placed, but no usable Sid: not an error (the phones ring); the id is stored as null.
    const odd = new ExotelCallsAdapter(
      CONFIG,
      fixtureFetch({ status: 200, body: { Call: { Sid: 'x y <script>' } } }).fetch,
    );
    expect(await odd.connect(REQUEST)).toEqual({ provider: 'exotel', providerCallId: null });
  });

  it('reads only the call id, final status and talk time from a status callback', () => {
    expect(parseExotelStatus(FIXTURES.exotel.statusCompleted)).toEqual({
      providerCallId: 'b6cfaf0e4f1b6a3bd8a1fdd0e2b1b9f2',
      status: 'COMPLETED',
      durationSeconds: 182,
    });
    // Form-encoded callbacks carry strings.
    expect(
      parseExotelStatus({ CallSid: 'abc123', Status: 'no-answer', ConversationDuration: '0' }),
    ).toEqual({ providerCallId: 'abc123', status: 'NO_ANSWER', durationSeconds: null });
    expect(parseExotelStatus({ CallSid: 'abc123', Status: 'busy' })?.status).toBe('BUSY');
    expect(parseExotelStatus({ CallSid: 'abc123', Status: 'canceled' })?.status).toBe('FAILED');
    expect(parseExotelStatus({ CallSid: 'abc123', Status: 'ringing' })).toBeNull();
    expect(parseExotelStatus({ CallSid: 'a b;drop', Status: 'completed' })).toBeNull();
    expect(parseExotelStatus(null)).toBeNull();
  });
});

describe('masked calls: console adapter, selection, window and webhook secret', () => {
  it('the console adapter records the bridge and answers with a fake call id', async () => {
    const adapter = new ConsoleCallsAdapter();
    expect(adapter.virtualNumber).toBe(CALLS_CONFIG.consoleVirtualNumber);
    const receipt = await adapter.connect(REQUEST);
    expect(receipt).toEqual({ provider: 'console-calls', providerCallId: 'console-call-1' });
    expect(adapter.placed).toEqual([{ ...REQUEST, providerCallId: 'console-call-1' }]);
  });

  it('CALLS_ADAPTER selects the adapter', () => {
    const { fetch } = fixtureFetch(FIXTURES.exotel.connected);
    expect(callsAdapter({ CALLS_ADAPTER: 'console' } as Env, fetch)).toBeInstanceOf(
      ConsoleCallsAdapter,
    );
    const exotel = {
      CALLS_ADAPTER: 'exotel',
      EXOTEL_ACCOUNT_SID: 'clickco1',
      EXOTEL_API_KEY: 'exotel-key-test',
      EXOTEL_API_TOKEN: 'exotel-token-test',
      EXOTEL_API_HOST: 'api.exotel.com',
      EXOTEL_CALLER_ID: '08047112233',
    } as Env;
    expect(callsAdapter(exotel, fetch)).toBeInstanceOf(ExotelCallsAdapter);
    expect(() => callsAdapter({ ...exotel, EXOTEL_CALLER_ID: undefined } as Env, fetch)).toThrow(
      /EXOTEL_CALLER_ID/,
    );
  });

  it('a binding is open until closed or past check-out + 2 h', () => {
    const now = new Date('2026-11-15T10:00:00Z');
    const binding = {
      id: 'b',
      bookingId: 'k',
      assignmentId: 'a',
      photographerId: 'p',
      userId: 'u',
      virtualNumber: '08047112233',
      openedAt: new Date('2026-11-14T10:00:00Z'),
      closesAt: null,
      closedAt: null,
    };
    expect(isOpen(binding, now)).toBe(true);
    expect(isOpen({ ...binding, closesAt: new Date(now.getTime() + 1) }, now)).toBe(true);
    expect(isOpen({ ...binding, closesAt: now }, now)).toBe(false);
    expect(isOpen({ ...binding, closedAt: now }, now)).toBe(false);
  });

  it('compares webhook secrets in constant time, accepts the previous one, refuses none', () => {
    const secret = 'x'.repeat(40);
    const previous = 'p'.repeat(40);
    expect(secretMatches(secret, [secret, undefined])).toBe(true);
    expect(secretMatches(`${secret}y`, [secret, undefined])).toBe(false);
    expect(secretMatches('', [secret])).toBe(false);
    expect(secretMatches(secret, [undefined, undefined])).toBe(false);
    // Rotation: the previous secret still works until Exotel uses the new URL.
    expect(secretMatches(previous, [secret, previous])).toBe(true);
  });
});
