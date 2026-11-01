import { z } from 'zod';
import {
  type FetchLike,
  isRetryableStatus,
  PROVIDER_TIMEOUT_MS,
  providerId,
  readJson,
} from '../../../common/http/fetch-like';
import {
  CallConnectError,
  type CallReceipt,
  type CallStatusUpdate,
  type CallsPort,
  type ConnectCallRequest,
} from '../calls.port';

export const EXOTEL_PROVIDER = 'exotel';

export interface ExotelConfig {
  readonly accountSid: string;
  readonly apiKey: string;
  readonly apiToken: string;
  /** api.exotel.com (Singapore) or api.in.exotel.com (Mumbai). */
  readonly host: string;
  /** The ExoPhone (virtual number) both sides see. */
  readonly callerId: string;
}

const callSid = (json: unknown): string | null => {
  const call =
    typeof json === 'object' && json !== null ? (json as { Call?: unknown }).Call : undefined;
  return providerId(
    typeof call === 'object' && call !== null ? (call as { Sid?: unknown }).Sid : undefined,
  );
};

/**
 * Exotel "connect two numbers" (ADR-0027 D3): POST /v1/Accounts/<sid>/Calls/connect.json, form
 * encoded — From is rung first, then To is bridged; both see CallerId (the ExoPhone). The API
 * key and token go in a Basic Authorization header (the documented user:pass@host form; fetch
 * refuses credentials inside a URL). The final status and duration come to StatusCallback.
 */
export class ExotelCallsAdapter implements CallsPort {
  readonly provider = EXOTEL_PROVIDER;

  constructor(
    private readonly config: ExotelConfig,
    private readonly fetch: FetchLike,
  ) {}

  get virtualNumber(): string {
    return this.config.callerId;
  }

  async connect(r: ConnectCallRequest): Promise<CallReceipt> {
    const form = new URLSearchParams({
      From: r.from,
      To: r.to,
      CallerId: this.config.callerId,
      TimeLimit: String(r.timeLimitSeconds),
      CustomField: r.callId,
    });
    if (r.statusCallbackUrl) {
      form.set('StatusCallback', r.statusCallbackUrl);
      form.set('StatusCallbackEvents[0]', 'terminal');
      form.set('StatusCallbackContentType', 'application/json');
    }
    const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiToken}`).toString('base64');
    const url = `https://${this.config.host}/v1/Accounts/${encodeURIComponent(this.config.accountSid)}/Calls/connect.json`;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${auth}`,
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      throw new CallConnectError('NETWORK', true);
    }
    const json = await readJson(res);
    if (res.status < 200 || res.status >= 300) {
      throw new CallConnectError(`HTTP_${res.status}`, isRetryableStatus(res.status));
    }
    // Placed: the phones are ringing. Without a usable Sid the status callback cannot be matched
    // (the call stays INITIATED), but it is not an error to retry.
    return { provider: EXOTEL_PROVIDER, providerCallId: callSid(json) };
  }
}

const STATUS_OF = {
  completed: 'COMPLETED',
  busy: 'BUSY',
  'no-answer': 'NO_ANSWER',
  failed: 'FAILED',
  canceled: 'FAILED',
} as const;

const Duration = z.union([z.number(), z.string().regex(/^\d{1,6}$/)]).transform(Number);

/** The fields Clickco reads from Exotel's terminal status callback (JSON or form encoded). */
const ExotelStatusCallback = z.object({
  CallSid: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  Status: z.enum(['completed', 'busy', 'no-answer', 'failed', 'canceled']),
  ConversationDuration: Duration.nullish(),
  DialCallDuration: Duration.nullish(),
});

/**
 * The status update in a callback body, or null for anything else (another event type, a
 * malformed body). Only the call id, the status and the talk time are kept.
 */
export function parseExotelStatus(body: unknown): CallStatusUpdate | null {
  const parsed = ExotelStatusCallback.safeParse(body);
  if (!parsed.success) return null;
  const status = STATUS_OF[parsed.data.Status];
  const seconds = parsed.data.ConversationDuration ?? parsed.data.DialCallDuration ?? null;
  return {
    providerCallId: parsed.data.CallSid,
    status,
    durationSeconds: status === 'COMPLETED' && seconds !== null ? Math.max(0, seconds) : null,
  };
}
