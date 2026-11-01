import {
  type FetchLike,
  isRetryableStatus,
  PROVIDER_TIMEOUT_MS,
  providerId,
  readJson,
} from '../../../common/http/fetch-like';
import {
  ChannelSendError,
  type PushMessage,
  type PushPort,
  type PushReceipt,
} from './channel.ports';

export const EXPO_PROVIDER = 'expo';
const SEND_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH = 100;

/** Ticket errors worth retrying; DeviceNotRegistered means revoke, the rest will not succeed. */
const RETRYABLE_TICKET_ERRORS: ReadonlySet<string> = new Set(['MessageRateExceeded']);

interface Ticket {
  readonly status: 'ok' | 'error';
  readonly id: string | null;
  readonly error: string | null;
}

const toTicket = (raw: unknown): Ticket => {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const details = (typeof o.details === 'object' && o.details !== null ? o.details : {}) as Record<
    string,
    unknown
  >;
  return {
    status: o.status === 'ok' ? 'ok' : 'error',
    id: providerId(o.id),
    error: typeof details.error === 'string' ? details.error : null,
  };
};

const ticketsOf = (json: unknown): Ticket[] | null => {
  const data = typeof json === 'object' && json !== null ? (json as { data?: unknown }).data : null;
  return Array.isArray(data) ? data.map(toTicket) : null;
};

/** A short code from a request-level error body ({ errors: [{ code }] }), else null. */
const requestErrorCode = (json: unknown): string | null => {
  const errors =
    typeof json === 'object' && json !== null ? (json as { errors?: unknown }).errors : null;
  const code = Array.isArray(errors) ? (errors[0] as { code?: unknown } | undefined)?.code : null;
  return typeof code === 'string' && /^[A-Z_]{2,60}$/.test(code) ? code : null;
};

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

/**
 * Expo push service (ADR-0027 D1; Expo → FCM / APNs): POST /--/api/v2/push/send, one message per
 * token, tickets in the same order. A `DeviceNotRegistered` ticket names a token to revoke.
 * Push receipts (the later delivery check) are not polled yet: tickets are what is recorded.
 */
export class ExpoPushAdapter implements PushPort {
  constructor(
    private readonly accessToken: string | null,
    private readonly fetch: FetchLike,
  ) {}

  async send(m: PushMessage): Promise<PushReceipt> {
    const tickets: { token: string; ticket: Ticket }[] = [];
    for (const batch of chunks(m.tokens, EXPO_BATCH)) {
      const answered = await this.sendBatch(batch, m);
      tickets.push(...batch.map((token, i) => ({ token, ticket: answered[i] ?? toTicket(null) })));
    }
    const ok = tickets.filter((t) => t.ticket.status === 'ok');
    const unregistered = tickets
      .filter((t) => t.ticket.error === 'DeviceNotRegistered')
      .map((t) => t.token);
    const otherError = tickets.find(
      (t) => t.ticket.status === 'error' && t.ticket.error !== 'DeviceNotRegistered',
    );
    if (ok.length === 0 && otherError) {
      const code = otherError.ticket.error ?? 'UNKNOWN';
      throw new ChannelSendError(
        `EXPO_${/^[A-Za-z]{2,60}$/.test(code) ? code : 'UNKNOWN'}`,
        RETRYABLE_TICKET_ERRORS.has(code),
      );
    }
    return {
      provider: EXPO_PROVIDER,
      providerMessageId: ok[0]?.ticket.id ?? null,
      delivered: ok.length,
      unregistered,
    };
  }

  private async sendBatch(tokens: readonly string[], m: PushMessage): Promise<Ticket[]> {
    const body = tokens.map((to) => ({
      to,
      title: m.title,
      body: m.body,
      data: m.data,
      sound: 'default',
      priority: 'high',
    }));
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetch(SEND_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      throw new ChannelSendError('NETWORK', true);
    }
    const json = await readJson(res);
    if (res.status < 200 || res.status >= 300) {
      const code = requestErrorCode(json);
      throw new ChannelSendError(
        code ? `EXPO_${code}` : `HTTP_${res.status}`,
        isRetryableStatus(res.status),
      );
    }
    const tickets = ticketsOf(json);
    if (!tickets || tickets.length !== tokens.length) {
      throw new ChannelSendError('EXPO_BAD_RESPONSE', true);
    }
    return tickets;
  }
}
