import { PhoneE164 } from '@clickco/contracts';
import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { ok } from '../../common/envelope';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ENV, type Env } from '../../config/env';
import { ConsoleSmsAdapter } from './sms/console-sms.adapter';
import { SMS_PORT, type SmsPort } from './sms/sms.port';

/**
 * Development convenience for the ops console's booking simulator. Answers 404
 * unless NODE_ENV=development, DEV_TOOLS=on (audit L5) AND the console SMS adapter is active.
 */
@Controller('dev')
export class DevOtpController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SMS_PORT) private readonly sms: SmsPort,
  ) {}

  @Get('otp/:phone')
  latest(@Param('phone', new ZodValidationPipe(PhoneE164)) phone: string) {
    const enabled =
      this.env.NODE_ENV === 'development' &&
      this.env.DEV_TOOLS === 'on' &&
      this.sms instanceof ConsoleSmsAdapter;
    const code = enabled ? (this.sms as ConsoleSmsAdapter).latestCode(phone) : null;
    if (!enabled || !code) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    return ok({ phone, code });
  }
}
