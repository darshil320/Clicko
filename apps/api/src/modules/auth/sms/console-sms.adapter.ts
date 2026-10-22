import { Injectable, Logger } from '@nestjs/common';
import type { SmsPort } from './sms.port';

const MAX_REMEMBERED = 100;

/**
 * DEVELOPMENT ONLY: prints the OTP to the server log and remembers the latest
 * code per phone for the dev console (GET /dev/otp/:phone). Env validation
 * refuses this adapter outside development and test.
 */
@Injectable()
export class ConsoleSmsAdapter implements SmsPort {
  private readonly logger = new Logger('DevSms');
  private latest = new Map<string, string>();

  async sendOtp(phone: string, code: string): Promise<void> {
    this.logger.warn(`[dev only] OTP for ******${phone.slice(-4)}: ${code}`);
    const next = new Map(this.latest);
    next.delete(phone);
    next.set(phone, code);
    if (next.size > MAX_REMEMBERED) next.delete(next.keys().next().value as string);
    this.latest = next;
  }

  latestCode(phone: string): string | null {
    return this.latest.get(phone) ?? null;
  }
}
