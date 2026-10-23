import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ok } from '../../common/envelope';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayPort,
} from '../payments/gateways/payment-gateway.port';
import { PaymentFlowService } from './payment-flow.service';

const headerOf = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

/**
 * Public, unauthenticated: trust comes only from the HMAC over the raw body (main.ts enables
 * rawBody). Valid signatures always get 200 — duplicates included — so the gateway stops retrying.
 */
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(
    @Inject(PaymentFlowService) private readonly flow: PaymentFlowService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    if (!req.rawBody) {
      throw new BadRequestException({
        code: 'RAW_BODY_REQUIRED',
        message: 'Webhooks must be sent as application/json',
      });
    }
    await this.flow.handleWebhook({
      provider,
      rawBody: req.rawBody,
      signature: headerOf(req, this.gateway.signatureHeader),
      eventId: headerOf(req, this.gateway.eventIdHeader),
    });
    return ok({ received: true });
  }
}
