import { createHash, timingSafeEqual } from 'node:crypto';
import { Uuid } from '@clickco/contracts';
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { ProGuard } from '../../common/guards/pro.guard';
import { UserGuard } from '../../common/guards/user.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ENV, type Env } from '../../config/env';
import type { Subject } from '../auth/token.service';
import { parseExotelStatus } from './adapters/exotel-calls.adapter';
import { CallsService } from './calls.service';

const IdPipe = new ZodValidationPipe(Uuid);

/** The client asks to talk to the assigned photographer (ADR-0027 D3). Owner only. */
@Controller('bookings')
// Audit L1: USER sessions of accounts that are not blocked, checked on every request.
@UseGuards(UserGuard)
export class ClientCallsController {
  constructor(@Inject(CallsService) private readonly calls: CallsService) {}

  @Post(':id/call')
  @HttpCode(200)
  async call(@CurrentSubject() s: Subject, @Param('id', IdPipe) bookingId: string) {
    return ok(await this.calls.callFromClient(s.id, bookingId));
  }
}

/** The assigned photographer asks to talk to the client (ADR-0027 D3). */
@Controller('pro/assignments')
@UseGuards(ProGuard)
export class ProCallsController {
  constructor(@Inject(CallsService) private readonly calls: CallsService) {}

  @Post(':assignmentId/call')
  @HttpCode(200)
  async call(@CurrentSubject() s: Subject, @Param('assignmentId', IdPipe) assignmentId: string) {
    return ok(await this.calls.callFromPhotographer(s.id, assignmentId));
  }
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Constant-time: equal-length digests, so neither content nor length leaks through timing. Every
 * configured secret is compared (no early exit): the current one and, during a rotation, the
 * previous one.
 */
export function secretMatches(given: string, accepted: readonly (string | undefined)[]): boolean {
  const g = digest(given);
  return accepted
    .filter((s): s is string => Boolean(s))
    .map((s) => timingSafeEqual(g, digest(s)))
    .reduce((any, ok) => any || ok, false);
}

/**
 * Exotel's status callback (ADR-0027 D3): trust comes from the secret in the path, compared in
 * constant time; a wrong or missing secret is 404 before anything is read. Only the call's
 * status and duration are kept. Exempt from the per-IP throttle like the payment webhooks: a
 * provider's retry burst must not be dropped, and a wrong secret touches nothing.
 *
 * The secret is part of the URL: every access log, proxy and APM in front of the API must redact
 * the path segment after /webhooks/exotel/call-status/ (launch checklist). Rotate with
 * EXOTEL_WEBHOOK_SECRET_PREVIOUS: both are accepted until Exotel uses the new URL.
 */
@SkipThrottle()
@Controller('webhooks/exotel')
export class ExotelWebhookController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CallsService) private readonly calls: CallsService,
  ) {}

  @Post('call-status/:secret')
  @HttpCode(200)
  async callStatus(@Param('secret') secret: string, @Body() body: unknown) {
    const accepted = [this.env.EXOTEL_WEBHOOK_SECRET, this.env.EXOTEL_WEBHOOK_SECRET_PREVIOUS];
    if (!secretMatches(secret, accepted)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    }
    const update = parseExotelStatus(body);
    const outcome = update ? await this.calls.recordStatus(update) : 'IGNORED';
    return ok({ received: true, outcome });
  }
}
