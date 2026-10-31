import { CreateBookingBody, type CreateBookingRequest, Uuid } from '@clickco/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { UserGuard } from '../../common/guards/user.guard';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { CheckoutService } from './checkout.service';
import { requireUser } from './http-errors';
import { PaymentFlowService } from './payment-flow.service';

const BookingId = new ZodValidationPipe(Uuid);

/** The client booking flow (ADR-0009). Every money-mutating route is @Idempotent. */
@Controller('bookings')
// Audit L1: USER sessions of accounts that are not blocked, checked on every request.
@UseGuards(UserGuard)
export class CheckoutController {
  constructor(
    @Inject(CheckoutService) private readonly checkout: CheckoutService,
    @Inject(PaymentFlowService) private readonly flow: PaymentFlowService,
  ) {}

  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(
    @CurrentSubject() subject: Subject,
    @Body(new ZodValidationPipe(CreateBookingBody)) body: CreateBookingRequest,
  ) {
    return ok(await this.checkout.create(requireUser(subject), body));
  }

  @Get()
  async list(@CurrentSubject() subject: Subject) {
    return ok(await this.checkout.list(requireUser(subject)));
  }

  @Get(':id')
  async detail(@CurrentSubject() subject: Subject, @Param('id', BookingId) id: string) {
    return ok(await this.checkout.detail(requireUser(subject), id));
  }

  @Post(':id/pay')
  @HttpCode(200)
  @Idempotent()
  async pay(@CurrentSubject() subject: Subject, @Param('id', BookingId) id: string) {
    return ok(await this.flow.pay(requireUser(subject), id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  async cancel(@CurrentSubject() subject: Subject, @Param('id', BookingId) id: string) {
    return ok(await this.checkout.cancel(requireUser(subject), id));
  }
}
