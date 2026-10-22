import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { AuthController } from './modules/auth/auth.controller';
import { PricingController } from './modules/pricing/pricing.controller';
import { ServiceabilityController } from './modules/serviceability/serviceability.controller';
import { UsersController } from './modules/users/users.controller';

// Vitest (esbuild) emits no decorator metadata, so this fails unless every
// constructor dependency is declared with @Inject — the same guarantee nest build needs.
describe('AppModule dependency graph', () => {
  it('resolves every provider and controller without a database', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '0',
      DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none',
      REDIS_URL: 'redis://127.0.0.1:1',
      JWT_ACCESS_SECRET: 'graph-test-access-secret-0123456789',
      OTP_HASH_PEPPER: 'graph-test-otp-pepper-0123456789abc',
      SMS_ADAPTER: 'console',
      TRUST_PROXY_HOPS: '0',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef.get(AuthController)).toBeInstanceOf(AuthController);
    expect(moduleRef.get(UsersController)).toBeInstanceOf(UsersController);
    expect(moduleRef.get(ServiceabilityController)).toBeInstanceOf(ServiceabilityController);
    expect(moduleRef.get(PricingController)).toBeInstanceOf(PricingController);
    await moduleRef.close();
  });
});
