import {
  type FetchLike,
  isRetryableStatus,
  PROVIDER_TIMEOUT_MS,
  providerId,
  readJson,
} from '../../../common/http/fetch-like';
import {
  ChannelSendError,
  type SendReceipt,
  type TemplatedMessage,
  type WhatsAppPort,
} from './channel.ports';

export interface MetaWhatsAppConfig {
  readonly phoneNumberId: string;
  readonly accessToken: string;
  /** Graph API version, e.g. v21.0. */
  readonly graphVersion: string;
}

const GRAPH_HOST = 'https://graph.facebook.com';
export const META_PROVIDER = 'meta-whatsapp';

/**
 * Graph error codes worth retrying: rate limits (4, 80007, 130429, 131048, 131056) and the
 * provider's own transient failures (1, 2, 131000, 131016, 133004). Everything else — an
 * undeliverable number (131026), a template mismatch (132xxx), an expired token (190) — will not
 * succeed on retry.
 */
const RETRYABLE_CODES: ReadonlySet<number> = new Set([
  1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056, 133004,
]);

interface GraphParameter {
  readonly type: 'text';
  readonly text: string;
}

/** The Cloud API template message body (business-initiated, approved template only). */
export function metaTemplateBody(m: TemplatedMessage): Record<string, unknown> {
  const param = (name: string): GraphParameter => ({
    type: 'text',
    text: m.variables[name] ?? '',
  });
  const components: Record<string, unknown>[] = [];
  if (m.template.bodyOrder.length > 0) {
    components.push({ type: 'body', parameters: m.template.bodyOrder.map(param) });
  }
  if (m.template.urlButton) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [param(m.template.urlButton)],
    });
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: m.to.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: m.template.whatsappName,
      language: { code: m.template.language },
      components,
    },
  };
}

const graphErrorCode = (json: unknown): number | null => {
  if (typeof json !== 'object' || json === null || !('error' in json)) return null;
  const error = (json as { error: unknown }).error;
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code: unknown }).code;
  return typeof code === 'number' ? code : null;
};

const messageId = (json: unknown): string | null => {
  if (typeof json !== 'object' || json === null || !('messages' in json)) return null;
  const messages = (json as { messages: unknown }).messages;
  if (!Array.isArray(messages)) return null;
  return providerId((messages[0] as { id?: unknown } | undefined)?.id);
};

/**
 * WhatsApp Business Cloud API (ADR-0027 D1): POST /<version>/<phone-number-id>/messages with an
 * approved template, its body parameters in `bodyOrder`, and the dynamic URL button suffix.
 * Errors carry only a code — never the number, the token or Meta's message text.
 */
export class MetaWhatsAppAdapter implements WhatsAppPort {
  constructor(
    private readonly config: MetaWhatsAppConfig,
    private readonly fetch: FetchLike,
  ) {}

  async sendTemplate(m: TemplatedMessage): Promise<SendReceipt> {
    const url = `${GRAPH_HOST}/${this.config.graphVersion}/${this.config.phoneNumberId}/messages`;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(metaTemplateBody(m)),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      throw new ChannelSendError('NETWORK', true);
    }
    const json = await readJson(res);
    // Accepted: Meta has the message. An unusable id is stored as null, never retried (a retry
    // would send it twice).
    if (res.status >= 200 && res.status < 300) {
      return { provider: META_PROVIDER, providerMessageId: messageId(json) };
    }
    const code = graphErrorCode(json);
    if (code !== null) {
      throw new ChannelSendError(
        `META_${code}`,
        RETRYABLE_CODES.has(code) || isRetryableStatus(res.status),
      );
    }
    throw new ChannelSendError(`HTTP_${res.status}`, isRetryableStatus(res.status));
  }
}
