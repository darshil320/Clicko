import { SimulatePaymentBody, Uuid } from '@clickco/contracts';
import { Body, Controller, HttpCode, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import type { z } from 'zod';
import { ok } from '../../common/envelope';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ENV, type Env } from '../../config/env';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayPort,
} from '../payments/gateways/payment-gateway.port';
import { type SandboxEvent, SandboxGateway } from '../payments/gateways/sandbox.gateway';
import { PaymentsService } from '../payments/payments.service';
import { PaymentFlowService } from './payment-flow.service';

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Not found' };

/**
 * Development only: lets the ops console's booking simulator "pay". Answers 404 unless
 * NODE_ENV=development AND the sandbox gateway is active. It signs a sandbox webhook exactly like
 * a real one and feeds it through the same verify → dedupe → apply path — no shortcut.
 */
@Controller('dev/payments')
export class DevPaymentsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PaymentFlowService) private readonly flow: PaymentFlowService,
  ) {}

  @Post(':paymentId/simulate')
  @HttpCode(200)
  async simulate(
    @Param('paymentId', new ZodValidationPipe(Uuid)) paymentId: string,
    @Body(new ZodValidationPipe(SimulatePaymentBody)) body: z.infer<typeof SimulatePaymentBody>,
  ) {
    const sandbox = this.enabledSandbox();
    const payment = await this.payments.findById(paymentId);
    if (!payment?.providerOrderId) throw new NotFoundException(NOT_FOUND);
    const event: SandboxEvent =
      body.outcome === 'FAILED'
        ? 'payment.failed'
        : payment.isAuthOnly
          ? 'payment.authorized'
          : 'payment.captured';
    const hook = sandbox.buildWebhook({
      providerOrderId: payment.providerOrderId,
      amountPaise: payment.amountPaise,
      event,
    });
    const outcome = await this.flow.handleWebhook({
      provider: sandbox.routeSlug,
      rawBody: hook.rawBody,
      signature: hook.signature,
      eventId: hook.eventId,
    });
    return ok({ paymentId, event, eventId: hook.eventId, outcome });
  }

  private enabledSandbox(): SandboxGateway {
    const gateway = this.gateway;
    const isDev = this.env.NODE_ENV === 'development' && this.env.PAYMENT_GATEWAY === 'sandbox';
    if (!isDev || !(gateway instanceof SandboxGateway)) throw new NotFoundException(NOT_FOUND);
    return gateway;
  }
}
