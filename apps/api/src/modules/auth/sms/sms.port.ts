/** Outbound OTP SMS. The DLT-registered adapter replaces the console one once TRAI DLT clears (PLAN B6). */
export interface SmsPort {
  sendOtp(phone: string, code: string): Promise<void>;
}
export const SMS_PORT = Symbol('SMS_PORT');
