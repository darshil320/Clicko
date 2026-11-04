import { PhoneE164 } from '@clickco/contracts';
import { Logger } from '@nestjs/common';
import type { Msg91FlowClient } from '../../../infra/sms/msg91-flow';
import { maskPhone } from '../../notifications/masking';
import { type SmsPort, SmsSendError } from './sms.port';

/** The OTP flow's one variable: the DLT template reads `… ##otp## …`. */
export const OTP_FLOW_VARIABLE = 'otp';

/** OtpService issues 6 digits; anything that is not a short digit run never reaches MSG91. */
const OTP_CODE = /^\d{4,8}$/;

/** The OTP template as registered: the MSG91 flow id and its DLT template id (named in logs). */
export interface Msg91OtpTemplate {
  readonly flowId: string;
  readonly dltTemplateId: string;
}

interface WarnLogger {
  warn(message: string): void;
}

/**
 * SMS_ADAPTER=dlt (ADR-0029 D1): the sign-in OTP on MSG91's flow API, on the same account as the
 * lifecycle SMS. Runs inside the OTP job (ADR-0012 D8), which retries only a retryable failure.
 * Logs show the number masked and never the code; errors carry a code only.
 */
export class Msg91OtpSmsAdapter implements SmsPort {
  constructor(
    private readonly template: Msg91OtpTemplate,
    private readonly client: Msg91FlowClient,
    private readonly logger: WarnLogger = new Logger('Msg91OtpSms'),
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    if (!PhoneE164.safeParse(phone).success) throw this.failure(phone, 'INVALID_PHONE', false);
    if (!OTP_CODE.test(code)) throw this.failure(phone, 'INVALID_CODE', false);
    const result = await this.client.send({
      flowId: this.template.flowId,
      to: phone,
      variables: { [OTP_FLOW_VARIABLE]: code },
    });
    if (!result.ok) throw this.failure(phone, result.code, result.retryable);
  }

  private failure(phone: string, code: string, retryable: boolean): SmsSendError {
    const next = retryable ? 'will retry' : 'final';
    this.logger.warn(
      `OTP SMS to ${maskPhone(phone)} failed: ${code} (${next}; DLT template ${this.template.dltTemplateId})`,
    );
    return new SmsSendError(code, retryable);
  }
}
