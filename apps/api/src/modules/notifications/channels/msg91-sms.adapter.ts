import { z } from 'zod';
import {
  type FetchLike,
  isRetryableStatus,
  PROVIDER_TIMEOUT_MS,
  providerId,
  readJson,
} from '../../../common/http/fetch-like';
import { TEMPLATE_CODES, TEMPLATES, type TemplateCode } from '../templates/templates';
import {
  ChannelSendError,
  type NotificationSmsPort,
  type SendReceipt,
  type TemplatedMessage,
} from './channel.ports';

export const MSG91_PROVIDER = 'msg91';
const FLOW_URL = 'https://control.msg91.com/api/v5/flow';

/** One SMS template as registered: the MSG91 flow (template) id and its DLT template id. */
const Msg91Template = z
  .object({
    flowId: z.string().regex(/^[A-Za-z0-9]{8,40}$/, 'flowId must be the MSG91 template id'),
    dltTemplateId: z.string().regex(/^\d{10,25}$/, 'dltTemplateId must be the DLT template id'),
  })
  .strict();
export type Msg91Template = z.infer<typeof Msg91Template>;

export type Msg91Templates = Readonly<Partial<Record<TemplateCode, Msg91Template>>>;

/** Templates the SMS channel carries: each needs a registered flow and DLT template. */
export const SMS_TEMPLATE_CODES: readonly TemplateCode[] = TEMPLATE_CODES.filter((c) =>
  (TEMPLATES[c].channels as readonly string[]).includes('SMS'),
);

/**
 * MSG91_TEMPLATES, checked at boot against the template catalogue: valid JSON, no unknown code,
 * and every SMS template present. Throws with the codes at fault (never a value).
 */
export function parseMsg91Templates(raw: string): Msg91Templates {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('MSG91_TEMPLATES is not valid JSON');
  }
  const parsed = z.record(z.string(), Msg91Template).safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw new Error(`MSG91_TEMPLATES is invalid at: ${where}`);
  }
  const unknown = Object.keys(parsed.data).filter(
    (code) => !(TEMPLATE_CODES as readonly string[]).includes(code),
  );
  if (unknown.length > 0) {
    throw new Error(`MSG91_TEMPLATES names unknown templates: ${unknown.join(', ')}`);
  }
  const missing = SMS_TEMPLATE_CODES.filter((code) => !parsed.data[code]);
  if (missing.length > 0) {
    throw new Error(`MSG91_TEMPLATES is missing SMS templates: ${missing.join(', ')}`);
  }
  return parsed.data as Msg91Templates;
}

export interface Msg91Config {
  readonly authKey: string;
  /** The DLT-registered header; sent for flows whose sender is "FromAPI". */
  readonly senderId: string;
  readonly templates: Msg91Templates;
}

const field = (json: unknown, key: string): unknown =>
  typeof json === 'object' && json !== null && key in json
    ? (json as Record<string, unknown>)[key]
    : undefined;

/**
 * MSG91 Flow API (DLT SMS, ADR-0027 D1): POST /api/v5/flow with the template (flow) id and one
 * recipient whose keys are the template's ##variables## — the `{name}` placeholders of the
 * template text, so the DLT template mirrors `text` exactly. MSG91 answers HTTP 200 with
 * `type: "error"` for a rejected request. No short URLs: the delivery link goes as registered.
 */
export class Msg91SmsAdapter implements NotificationSmsPort {
  constructor(
    private readonly config: Msg91Config,
    private readonly fetch: FetchLike,
  ) {}

  async sendTemplate(m: TemplatedMessage): Promise<SendReceipt> {
    const registered = this.config.templates[m.template.code as TemplateCode];
    if (!registered) throw new ChannelSendError('MSG91_TEMPLATE_NOT_REGISTERED', false);
    const body = {
      template_id: registered.flowId,
      sender: this.config.senderId,
      short_url: '0',
      recipients: [{ mobiles: m.to.replace(/\D/g, ''), ...m.placeholders }],
    };
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetch(FLOW_URL, {
        method: 'POST',
        headers: {
          authkey: this.config.authKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      throw new ChannelSendError('NETWORK', true);
    }
    const json = await readJson(res);
    if (res.status < 200 || res.status >= 300) {
      throw new ChannelSendError(`HTTP_${res.status}`, isRetryableStatus(res.status));
    }
    if (field(json, 'type') !== 'success') throw new ChannelSendError('MSG91_REJECTED', false);
    // On success `message` is the request id; anything else is never stored verbatim.
    return { provider: MSG91_PROVIDER, providerMessageId: providerId(field(json, 'message')) };
  }
}
