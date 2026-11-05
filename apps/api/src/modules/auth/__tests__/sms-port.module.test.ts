import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { HTTP_FETCH } from '../../../common/http/fetch-like';
import { ENV, type Env, loadEnv } from '../../../config/env';
import { MSG91_FIXTURES } from '../../../infra/sms/__tests__/msg91-fixtures';
import { fixtureFetch } from '../../../test-support/fixture-fetch';
import { OtpDelivery } from '../otp-delivery';
import { ConsoleSmsAdapter } from '../sms/console-sms.adapter';
import { Msg91OtpSmsAdapter } from '../sms/msg91-otp-sms.adapter';
import { SMS_PORT, type SmsPort } from '../sms/sms.port';
import { otpSmsAdapter } from '../sms/sms-providers';

/** MSG91 settings for the OTP SMS: test-only values, not real credentials. */
const MSG91_OTP = {
  MSG91_AUTH_KEY: 'msg91-test-only-auth-key',
  MSG91_SENDER_ID: 'CLKCOO',
  MSG91_DLT_ENTITY_ID: '1201160000000000000',
  MSG91_OTP_FLOW_ID: '65f0a1b2c3d4e5f6a7b8c9d0',
  MSG91_OTP_DLT_TEMPLATE_ID: '1107172000000000042',
  MSG91_DELETE_OTP_FLOW_ID: '65f0a1b2c3d4e5f6a7b8c9d1',
  MSG91_DELETE_OTP_DLT_TEMPLATE_ID: '1107172000000000043',
};

/** A test-mode environment with no database or Redis behind it (nothing connects at compile). */
const envWith = (sms: Record<string, string>): Env =>
  loadEnv({
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none',
    REDIS_URL: 'redis://127.0.0.1:1',
    QUEUE_WORKERS: 'off',
    JWT_ACCESS_SECRET: 'sms-port-test-access-secret-0123456789',
    OTP_HASH_PEPPER: 'sms-port-test-otp-pepper-0123456789ab',
    TRUST_PROXY_HOPS: '0',
    ...sms,
  });

describe('SMS_PORT by SMS_ADAPTER', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('the factory picks the console adapter or the MSG91 one', () => {
    const { fetch } = fixtureFetch(MSG91_FIXTURES.sent);
    expect(otpSmsAdapter(envWith({ SMS_ADAPTER: 'console' }), fetch)).toBeInstanceOf(
      ConsoleSmsAdapter,
    );
    expect(otpSmsAdapter(envWith({ SMS_ADAPTER: 'dlt', ...MSG91_OTP }), fetch)).toBeInstanceOf(
      Msg91OtpSmsAdapter,
    );
  });

  it('SMS_ADAPTER=dlt boots the API with the MSG91 adapter behind OtpDelivery (no longer throws)', async () => {
    const { fetch, requests } = fixtureFetch(MSG91_FIXTURES.sent);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(envWith({ SMS_ADAPTER: 'dlt', ...MSG91_OTP }))
      .overrideProvider(HTTP_FETCH)
      .useValue(fetch)
      .compile();
    try {
      const sms = moduleRef.get<SmsPort>(SMS_PORT);
      expect(sms).toBeInstanceOf(Msg91OtpSmsAdapter);
      expect(moduleRef.get(OtpDelivery)).toBeInstanceOf(OtpDelivery);
      await sms.sendOtp('+919812345678', '424242');
      expect(requests.map((r) => r.url)).toEqual(['https://control.msg91.com/api/v5/flow']);
      expect(requests[0]?.headers.authkey).toBe(MSG91_OTP.MSG91_AUTH_KEY);
    } finally {
      await moduleRef.close();
    }
  });
});
