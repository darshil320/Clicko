import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../config/env';
import { DevOtpController } from '../dev-otp.controller';
import { ConsoleSmsAdapter } from '../sms/console-sms.adapter';

const env = (NODE_ENV: Env['NODE_ENV'], DEV_TOOLS: Env['DEV_TOOLS'] = 'on') =>
  ({ NODE_ENV, DEV_TOOLS }) as Env;
const statusOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
  return 200;
};

describe('DevOtpController', () => {
  it('returns the latest code in development with the console adapter', async () => {
    const sms = new ConsoleSmsAdapter();
    await sms.sendOtp('+919876543210', '111111');
    await sms.sendOtp('+919876543210', '222222');
    const res = new DevOtpController(env('development'), sms).latest('+919876543210');
    expect(res.data).toEqual({ phone: '+919876543210', code: '222222' });
  });

  it('is a 404 in test, staging and production', async () => {
    const sms = new ConsoleSmsAdapter();
    await sms.sendOtp('+919876543210', '111111');
    for (const e of ['test', 'staging', 'production'] as const) {
      expect(statusOf(() => new DevOtpController(env(e), sms).latest('+919876543210'))).toBe(404);
    }
  });

  it('L5: is a 404 in development unless DEV_TOOLS=on', async () => {
    const sms = new ConsoleSmsAdapter();
    await sms.sendOtp('+919876543210', '111111');
    expect(
      statusOf(() => new DevOtpController(env('development', 'off'), sms).latest('+919876543210')),
    ).toBe(404);
  });

  it('is a 404 with any real SMS adapter', () => {
    const real = { sendOtp: async () => {} };
    expect(
      statusOf(() => new DevOtpController(env('development'), real).latest('+919876543210')),
    ).toBe(404);
  });
});
