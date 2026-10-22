import { Injectable, Logger } from '@nestjs/common';
import type { SmsPort } from './sms.port';

/**
 * DEVELOPMENT ONLY: prints the OTP to the server log. Env validation refuses this
 * adapter when NODE_ENV is staging or production.
 */
@Injectable()
export class ConsoleSmsAdapter implements SmsPort {
  private readonly logger = new Logger('DevSms');

  async sendOtp(phone: string, code: string): Promise<void> {
    this.logger.warn(`[dev only] OTP for ******${phone.slice(-4)}: ${code}`);
  }
}
