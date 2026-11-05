import type { FetchLike } from '../../../common/http/fetch-like';
import type { Env } from '../../../config/env';
import { Msg91FlowClient } from '../../../infra/sms/msg91-flow';
import { ConsoleSmsAdapter } from './console-sms.adapter';
import { Msg91OtpSmsAdapter } from './msg91-otp-sms.adapter';
import type { SmsPort } from './sms.port';

/** env.ts guarantees these whenever SMS_ADAPTER=dlt; this re-checks. */
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required by SMS_ADAPTER=dlt`);
  return value;
}

/** SMS_PORT by SMS_ADAPTER: console (development and test only) or MSG91 (ADR-0029 D1). */
export function otpSmsAdapter(env: Env, fetch: FetchLike): SmsPort {
  if (env.SMS_ADAPTER === 'console') return new ConsoleSmsAdapter();
  return new Msg91OtpSmsAdapter(
    {
      signIn: {
        flowId: required(env.MSG91_OTP_FLOW_ID, 'MSG91_OTP_FLOW_ID'),
        dltTemplateId: required(env.MSG91_OTP_DLT_TEMPLATE_ID, 'MSG91_OTP_DLT_TEMPLATE_ID'),
      },
      // ADR-0030: the account-deletion code on its own DLT template.
      accountDelete: {
        flowId: required(env.MSG91_DELETE_OTP_FLOW_ID, 'MSG91_DELETE_OTP_FLOW_ID'),
        dltTemplateId: required(
          env.MSG91_DELETE_OTP_DLT_TEMPLATE_ID,
          'MSG91_DELETE_OTP_DLT_TEMPLATE_ID',
        ),
      },
    },
    new Msg91FlowClient(
      {
        authKey: required(env.MSG91_AUTH_KEY, 'MSG91_AUTH_KEY'),
        senderId: required(env.MSG91_SENDER_ID, 'MSG91_SENDER_ID'),
      },
      fetch,
    ),
  );
}
