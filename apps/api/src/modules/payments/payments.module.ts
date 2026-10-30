import { Module } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { ENV, type Env } from '../../config/env';
import { AuthHoldsService } from './auth-holds.service';
import { PAYMENT_GATEWAY, type PaymentGatewayPort } from './gateways/payment-gateway.port';
import { RazorpayGateway } from './gateways/razorpay.gateway';
import { SandboxGateway } from './gateways/sandbox.gateway';
import { InvoicesService } from './invoices.service';
import { LedgerService } from './ledger/ledger.service';
import { PaymentRefundsService } from './payment-refunds.service';
import { PaymentsService } from './payments.service';
import { PaymentsSubscribers } from './payments.subscribers';
import { CreditNotesRepository } from './repositories/credit-notes.repository';
import { InvoicesRepository } from './repositories/invoices.repository';
import { PaymentsRepository } from './repositories/payments.repository';
import { RefundTargetsRepository } from './repositories/refund-targets.repository';
import { WebhookEventsRepository } from './repositories/webhook-events.repository';

/** env.ts guarantees the sandbox never runs in staging/production and that Razorpay has its keys. */
function gatewayFor(env: Env, clock: Clock): PaymentGatewayPort {
  if (env.PAYMENT_GATEWAY === 'sandbox') {
    return new SandboxGateway(env.SANDBOX_WEBHOOK_SECRET, clock);
  }
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_WEBHOOK_SECRET) {
    throw new Error(
      'PAYMENT_GATEWAY=razorpay needs RAZORPAY_KEY_ID, _KEY_SECRET and _WEBHOOK_SECRET',
    );
  }
  return new RazorpayGateway({
    keyId: RAZORPAY_KEY_ID,
    keySecret: RAZORPAY_KEY_SECRET,
    webhookSecret: RAZORPAY_WEBHOOK_SECRET,
  });
}

/** No controllers: the webhook endpoint lives in checkout, which applies outcomes to bookings. */
@Module({
  providers: [
    { provide: PAYMENT_GATEWAY, inject: [ENV, CLOCK], useFactory: gatewayFor },
    PaymentsRepository,
    WebhookEventsRepository,
    InvoicesRepository,
    LedgerService,
    InvoicesService,
    PaymentsService,
    AuthHoldsService,
    PaymentsSubscribers,
    RefundTargetsRepository,
    CreditNotesRepository,
    PaymentRefundsService,
  ],
  exports: [PaymentsService, AuthHoldsService, PaymentRefundsService, PAYMENT_GATEWAY],
})
export class PaymentsModule {}
