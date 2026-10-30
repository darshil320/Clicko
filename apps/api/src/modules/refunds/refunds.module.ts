import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { OpsModule } from '../ops/ops.module';
import { PaymentsModule } from '../payments/payments.module';
import { SlaModule } from '../sla/sla.module';
import { BookingMoneyReader } from './booking-money.reader';
import { CreditsService } from './credits.service';
import { RefundsService } from './refunds.service';
import { RefundsSubscribers } from './refunds.subscribers';
import { CreditsRepository } from './repositories/credits.repository';
import { RefundsRepository } from './repositories/refunds.repository';
import { ResolutionsRepository } from './repositories/resolutions.repository';
import { ReviewsService } from './reviews.service';

/**
 * Refunds, client credits and review settlements (ADR-0026 D1/D2). Owns refunds, client_credits
 * and review_resolutions. Money mechanics (gateway, payments, credit notes, ledger) go through
 * PaymentRefundsService; breaches through SlaDeskService; review events through OpsAlertsReader;
 * bookings through BookingsService — never their tables.
 */
@Module({
  imports: [BookingsModule, PaymentsModule, SlaModule, OpsModule],
  providers: [
    RefundsRepository,
    CreditsRepository,
    ResolutionsRepository,
    BookingMoneyReader,
    RefundsService,
    CreditsService,
    ReviewsService,
    RefundsSubscribers,
  ],
  exports: [RefundsService, CreditsService, ReviewsService, BookingMoneyReader],
})
export class RefundsModule {}
