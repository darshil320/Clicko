/**
 * Outbound OTP SMS: the console adapter in development and test, MSG91 on the DLT-registered OTP
 * template when SMS_ADAPTER=dlt (ADR-0029 D1).
 */
export interface SmsPort {
  /** Throws SmsSendError on a provider failure. */
  sendOtp(phone: string, code: string): Promise<void>;
}
export const SMS_PORT = Symbol('SMS_PORT');

/**
 * A failed OTP SMS: a short code and whether a retry may succeed (the OTP job retries only those).
 * Never the number, the code or the provider's own message (which can echo the number).
 */
export class SmsSendError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`OTP SMS send failed: ${code}`);
    this.name = 'SmsSendError';
  }
}
