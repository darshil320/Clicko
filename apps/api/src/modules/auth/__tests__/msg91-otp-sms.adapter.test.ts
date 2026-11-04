import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../../../common/http/fetch-like';
import { MSG91_FIXTURES } from '../../../infra/sms/__tests__/msg91-fixtures';
import { Msg91FlowClient } from '../../../infra/sms/msg91-flow';
import { type FixtureReply, fixtureFetch } from '../../../test-support/fixture-fetch';
import { Msg91OtpSmsAdapter, OTP_FLOW_VARIABLE } from '../sms/msg91-otp-sms.adapter';
import { SmsSendError } from '../sms/sms.port';

const PHONE = '+919812345678';
const CODE = '424242';
const OTP_FLOW = { flowId: '65f0a1b2c3d4e5f6a7b8c9d0', dltTemplateId: '1107172000000000042' };
const CREDENTIALS = { authKey: 'msg91-auth-key-test', senderId: 'CLICKO' };

class RecordingLogger {
  lines: string[] = [];
  warn(message: string): void {
    this.lines = [...this.lines, message];
  }
}

function setup(fetch: FetchLike, timeoutMs?: number) {
  const logger = new RecordingLogger();
  const client = new Msg91FlowClient(CREDENTIALS, fetch, timeoutMs);
  return { adapter: new Msg91OtpSmsAdapter(OTP_FLOW, client, logger), logger };
}

/** A fetch that never answers: only the request's abort signal ends it (a provider timeout). */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

/** What a failed send may say: a code, never the number, the OTP or the provider's text. */
async function sendError(p: Promise<unknown>): Promise<SmsSendError> {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SmsSendError);
  const e = error as SmsSendError;
  expect(e.message).not.toMatch(/9812345678|424242|Authentication|Template|Invalid mobile/i);
  return e;
}

/** Log lines may name the number only masked, and never the code. */
function expectNoPii(lines: readonly string[]): void {
  for (const line of lines) {
    expect(line).not.toContain('9812345678');
    expect(line).not.toContain(CODE);
  }
}

describe('MSG91 OTP SMS adapter (SMS_ADAPTER=dlt, ADR-0029 D1)', () => {
  it('sends the OTP flow: auth key header, DLT sender, digits-only number, the code as ##otp##', async () => {
    const { fetch, requests } = fixtureFetch(MSG91_FIXTURES.sent);
    const { adapter, logger } = setup(fetch);
    await adapter.sendOtp(PHONE, CODE);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req?.url).toBe('https://control.msg91.com/api/v5/flow');
    expect(req?.method).toBe('POST');
    expect(req?.headers.authkey).toBe('msg91-auth-key-test');
    expect(req?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(req?.body ?? '{}')).toEqual({
      template_id: OTP_FLOW.flowId,
      sender: 'CLICKO',
      short_url: '0',
      recipients: [{ mobiles: '919812345678', [OTP_FLOW_VARIABLE]: CODE }],
    });
    expect(OTP_FLOW_VARIABLE).toBe('otp');
    expect(logger.lines).toEqual([]);
  });

  it('a bad auth key (401) is final: no retry can fix it', async () => {
    const { adapter, logger } = setup(fixtureFetch(MSG91_FIXTURES.unauthorised).fetch);
    expect(await sendError(adapter.sendOtp(PHONE, CODE))).toMatchObject({
      code: 'HTTP_401',
      retryable: false,
    });
    expect(logger.lines).toEqual([
      `OTP SMS to ******5678 failed: HTTP_401 (final; DLT template ${OTP_FLOW.dltTemplateId})`,
    ]);
    expectNoPii(logger.lines);
  });

  it('a template error is final, whether a 4xx or a 200 with type "error"', async () => {
    const send = (reply: FixtureReply) =>
      setup(fixtureFetch(reply).fetch).adapter.sendOtp(PHONE, CODE);
    expect(await sendError(send(MSG91_FIXTURES.templateInvalid))).toMatchObject({
      code: 'HTTP_400',
      retryable: false,
    });
    expect(await sendError(send(MSG91_FIXTURES.rejected))).toMatchObject({
      code: 'MSG91_REJECTED',
      retryable: false,
    });
  });

  it('5xx and 429 retry', async () => {
    const send = (reply: FixtureReply) =>
      setup(fixtureFetch(reply).fetch).adapter.sendOtp(PHONE, CODE);
    expect(await sendError(send(MSG91_FIXTURES.outage))).toMatchObject({
      code: 'HTTP_503',
      retryable: true,
    });
    expect(await sendError(send(MSG91_FIXTURES.badGateway))).toMatchObject({
      code: 'HTTP_502',
      retryable: true,
    });
    expect(await sendError(send(MSG91_FIXTURES.rateLimited))).toMatchObject({
      code: 'HTTP_429',
      retryable: true,
    });
  });

  it('a timeout retries (the request is aborted, not left hanging)', async () => {
    const { adapter, logger } = setup(hangingFetch, 20);
    expect(await sendError(adapter.sendOtp(PHONE, CODE))).toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
    expect(logger.lines).toEqual([
      `OTP SMS to ******5678 failed: TIMEOUT (will retry; DLT template ${OTP_FLOW.dltTemplateId})`,
    ]);
  });

  it('an accepted send whose answer is cut off counts as sent (a retry could bill a second SMS)', async () => {
    const cutOff: FetchLike = async () => ({
      status: 200,
      text: () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    });
    const { adapter, logger } = setup(cutOff);
    await expect(adapter.sendOtp(PHONE, CODE)).resolves.toBeUndefined();
    expect(logger.lines).toEqual([]);
  });

  it('never follows a redirect: the auth key and the code go to MSG91 only', async () => {
    let redirect: string | undefined;
    const spy: FetchLike = async (url, init) => {
      redirect = init.redirect;
      return fixtureFetch(MSG91_FIXTURES.sent).fetch(url, init);
    };
    await setup(spy).adapter.sendOtp(PHONE, CODE);
    expect(redirect).toBe('error');
  });

  it('a network failure retries', async () => {
    const { adapter } = setup(fixtureFetch(new TypeError('fetch failed')).fetch);
    expect(await sendError(adapter.sendOtp(PHONE, CODE))).toMatchObject({
      code: 'NETWORK',
      retryable: true,
    });
  });

  it('refuses a malformed number or code before calling MSG91 (final, nothing logged in clear)', async () => {
    const { fetch, requests } = fixtureFetch(MSG91_FIXTURES.sent);
    const { adapter, logger } = setup(fetch);
    expect(await sendError(adapter.sendOtp('9812345678', CODE))).toMatchObject({
      code: 'INVALID_PHONE',
      retryable: false,
    });
    expect(await sendError(adapter.sendOtp(PHONE, '42'))).toMatchObject({
      code: 'INVALID_CODE',
      retryable: false,
    });
    expect(await sendError(adapter.sendOtp(PHONE, '42424a'))).toMatchObject({
      code: 'INVALID_CODE',
      retryable: false,
    });
    expect(requests).toHaveLength(0);
    expectNoPii(logger.lines);
  });
});
