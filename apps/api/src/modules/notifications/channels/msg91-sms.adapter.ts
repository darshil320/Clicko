import { z } from 'zod';
import type { FetchLike } from '../../../common/http/fetch-like';
import {
  DLT_TEMPLATE_ID,
  MSG91_FLOW_ID,
  MSG91_PROVIDER,
  type Msg91Credentials,
  Msg91FlowClient,
} from '../../../infra/sms/msg91-flow';
import { TEMPLATE_CODES, TEMPLATES, type TemplateCode } from '../templates/templates';
import {
  ChannelSendError,
  type NotificationSmsPort,
  type SendReceipt,
  type TemplatedMessage,
} from './channel.ports';

/** One SMS template as registered: the MSG91 flow (template) id and its DLT template id. */
const Msg91Template = z
  .object({
    flowId: z.string().regex(MSG91_FLOW_ID, 'flowId must be the MSG91 template id'),
    dltTemplateId: z.string().regex(DLT_TEMPLATE_ID, 'dltTemplateId must be the DLT template id'),
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

export interface Msg91Config extends Msg91Credentials {
  readonly templates: Msg91Templates;
}

/**
 * Lifecycle SMS on the MSG91 Flow API (DLT, ADR-0027 D1) through the shared client: the recipient's
 * keys are the template's ##variables## — the `{name}` placeholders of the template text, so the
 * DLT template mirrors `text` exactly. No short URLs: the delivery link goes as registered.
 */
export class Msg91SmsAdapter implements NotificationSmsPort {
  private readonly client: Msg91FlowClient;

  constructor(
    private readonly config: Msg91Config,
    fetch: FetchLike,
  ) {
    this.client = new Msg91FlowClient(config, fetch);
  }

  async sendTemplate(m: TemplatedMessage): Promise<SendReceipt> {
    const registered = this.config.templates[m.template.code as TemplateCode];
    if (!registered) throw new ChannelSendError('MSG91_TEMPLATE_NOT_REGISTERED', false);
    const result = await this.client.send({
      flowId: registered.flowId,
      to: m.to,
      variables: m.placeholders,
    });
    if (!result.ok) throw new ChannelSendError(result.code, result.retryable);
    return { provider: MSG91_PROVIDER, providerMessageId: result.requestId };
  }
}
