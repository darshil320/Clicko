import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ok } from '../../common/envelope';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayPort,
} from '../payments/gateways/payment-gateway.port';
import { PaymentFlowService } from './payment-flow.service';
import { WebhookSignatureLimiter } from './webhook-signature-limiter';

const headerOf = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

const isBadSignature = (error: unknown): boolean => {
  if (!(error instanceof BadRequestException)) return false;
  const body = error.getResponse();
  return typeof body === 'object' && body !== null && 'code' in body
    ? body.code === 'WEBHOOK_SIGNATURE_INVALID'
    : false;
};

/**
 * Public, unauthenticated: trust comes only from the HMAC over the raw body (main.ts enables
 * rawBody). Valid signatures always get 200 — duplicates included — so the gateway stops retrying.
 * Audit M3: exempt from the global per-IP throttle (a gateway retry burst must never be dropped);
 * instead bad signatures are limited per caller IP (WebhookSignatureLimiter) and past the limit
 * that IP's unverified requests are 429 before anything touches the database.
 */
@SkipThrottle()
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(
    @Inject(PaymentFlowService) private readonly flow: PaymentFlowService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
    @Inject(WebhookSignatureLimiter) private readonly limiter: WebhookSignatureLimiter,
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
    const ip = req.ip ?? 'unknown';
    const signature = headerOf(req, this.gateway.signatureHeader);
    if (
      (await this.limiter.overLimit(ip)) &&
      !this.gateway.verifyWebhookSignature(req.rawBody, signature)
    ) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many invalid webhook signatures' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      await this.flow.handleWebhook({
        provider,
        rawBody: req.rawBody,
        signature,
        eventId: headerOf(req, this.gateway.eventIdHeader),
      });
    } catch (error) {
      if (isBadSignature(error)) await this.limiter.recordInvalid(ip);
      throw error;
    }
    return ok({ received: true });
  }
}
