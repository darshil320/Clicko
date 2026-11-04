import {
  type FetchLike,
  isRetryableStatus,
  PROVIDER_TIMEOUT_MS,
  providerId,
  readJson,
} from '../../common/http/fetch-like';

export const MSG91_PROVIDER = 'msg91';
export const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow';

/** An MSG91 flow (template) id. */
export const MSG91_FLOW_ID = /^[A-Za-z0-9]{8,40}$/;
/** A TRAI DLT template id. */
export const DLT_TEMPLATE_ID = /^\d{10,25}$/;

/** The MSG91 account, shared by the OTP SMS (auth) and the lifecycle SMS (notifications). */
export interface Msg91Credentials {
  readonly authKey: string;
  /** The DLT-registered header; sent for flows whose sender is "FromAPI". */
  readonly senderId: string;
}

export interface Msg91FlowMessage {
  readonly flowId: string;
  /** E.164 (+91…); sent as digits only. */
  readonly to: string;
  /** The flow's ##variables##, by name. */
  readonly variables: Readonly<Record<string, string>>;
}

/**
 * A failure is a short code and whether a retry may succeed: never the number, the variables or
 * MSG91's own message (which can echo the number).
 */
export type Msg91FlowResult =
  | { readonly ok: true; readonly requestId: string | null }
  | { readonly ok: false; readonly code: string; readonly retryable: boolean };

const field = (json: unknown, key: string): unknown =>
  typeof json === 'object' && json !== null && key in json
    ? (json as Record<string, unknown>)[key]
    : undefined;

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

/** No answer, or no readable one: a retry may succeed. */
const transportFailure = (error: unknown): Msg91FlowResult => ({
  ok: false,
  code: isTimeout(error) ? 'TIMEOUT' : 'NETWORK',
  retryable: true,
});

/**
 * MSG91 Flow API (DLT SMS, ADR-0027 D1, ADR-0029 D1): POST /api/v5/flow with the flow id and one
 * recipient whose other keys are the flow's ##variables##. MSG91 answers HTTP 200 with
 * `type: "error"` for a request it rejects (final). 408, 425, 429, 5xx, a timeout and a network
 * failure may succeed later; any other 4xx (a bad key, an unknown template) will not. A 2xx whose
 * body cannot be read counts as sent (with no request id): retrying it could send the SMS twice.
 */
export class Msg91FlowClient {
  constructor(
    private readonly credentials: Msg91Credentials,
    private readonly fetch: FetchLike,
    private readonly timeoutMs: number = PROVIDER_TIMEOUT_MS,
  ) {}

  async send(m: Msg91FlowMessage): Promise<Msg91FlowResult> {
    const body = {
      template_id: m.flowId,
      sender: this.credentials.senderId,
      short_url: '0',
      // `mobiles` last: a variable can never redirect the message.
      recipients: [{ ...m.variables, mobiles: m.to.replace(/\D/g, '') }],
    };
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetch(MSG91_FLOW_URL, {
        method: 'POST',
        headers: {
          authkey: this.credentials.authKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        // The auth key and the message go to MSG91 only, never on to wherever a redirect points.
        redirect: 'error',
      });
    } catch (error) {
      return transportFailure(error);
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, code: `HTTP_${res.status}`, retryable: isRetryableStatus(res.status) };
    }
    let json: unknown;
    try {
      json = await readJson(res);
    } catch {
      // Accepted, but the answer was cut off: count it as sent. A retry could bill a second SMS.
      return { ok: true, requestId: null };
    }
    if (field(json, 'type') !== 'success') {
      return { ok: false, code: 'MSG91_REJECTED', retryable: false };
    }
    // On success `message` is the request id; anything else is never stored verbatim.
    return { ok: true, requestId: providerId(field(json, 'message')) };
  }
}
