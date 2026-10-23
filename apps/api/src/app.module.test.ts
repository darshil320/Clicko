import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { DevToolsModule } from './dev/dev-tools.module';
import { AuthController } from './modules/auth/auth.controller';
import { ProAuthController } from './modules/auth/pro-auth.controller';
import { CheckoutController } from './modules/checkout/checkout.controller';
import { DevPaymentsController } from './modules/checkout/dev-payments.controller';
import { PaymentWebhooksController } from './modules/checkout/payment-webhooks.controller';
import { DevDispatchController } from './modules/dispatch/dev-dispatch.controller';
import { ProAssignmentsController } from './modules/dispatch/pro-assignments.controller';
import { ProOffersController } from './modules/dispatch/pro-offers.controller';
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
      QUEUE_WORKERS: 'off',
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
    expect(moduleRef.get(CheckoutController)).toBeInstanceOf(CheckoutController);
    expect(moduleRef.get(PaymentWebhooksController)).toBeInstanceOf(PaymentWebhooksController);
    expect(moduleRef.get(ProAuthController)).toBeInstanceOf(ProAuthController);
    expect(moduleRef.get(ProOffersController)).toBeInstanceOf(ProOffersController);
    expect(moduleRef.get(ProAssignmentsController)).toBeInstanceOf(ProAssignmentsController);
    // Dev-only routes are not mounted outside NODE_ENV=development (ADR-0012).
    expect(() => moduleRef.get(DevPaymentsController)).toThrow();
    expect(() => moduleRef.get(DevDispatchController)).toThrow();
    await moduleRef.close();
  });

  it('resolves the development tools (OTP peek, payment simulator, dispatch desk)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DevToolsModule],
    }).compile();
    expect(moduleRef.get(DevPaymentsController)).toBeInstanceOf(DevPaymentsController);
    expect(moduleRef.get(DevDispatchController)).toBeInstanceOf(DevDispatchController);
    await moduleRef.close();
  });
});
