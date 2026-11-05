import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { AuthModule } from '../auth/auth.module';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { RefundsModule } from '../refunds/refunds.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { SafetyModule } from '../safety/safety.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { UsersModule } from '../users/users.module';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';

/**
 * ADR-0030 — client account deletion. Owns no table: it orchestrates, in one transaction, the
 * erasure each owning module exposes (users, bookings, reviews, notifications, safety,
 * serviceability, payments, auth, idempotency); refunds, credits and review items are read.
 * Nothing imports this module, so it can depend on all of them without a cycle.
 */
@Module({
  imports: [
    TokenModule,
    IdempotencyModule,
    AuthModule,
    UsersModule,
    BookingsModule,
    RefundsModule,
    PaymentsModule,
    ReviewsModule,
    NotificationsModule,
    SafetyModule,
    ServiceabilityModule,
  ],
  controllers: [AccountDeletionController],
  providers: [AccountDeletionService],
})
export class AccountDeletionModule {}
