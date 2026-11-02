import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { BookingsModule } from '../bookings/bookings.module';
import { ClaimsService } from './claims.service';
import { ClientCareController } from './client-care.controller';
import { QualityService } from './quality.service';
import { EquipmentClaimsRepository } from './repositories/equipment-claims.repository';
import { QualityEscalationsRepository } from './repositories/quality-escalations.repository';
import { SupportTicketsRepository } from './repositories/support-tickets.repository';
import { TicketsService } from './tickets.service';

/**
 * Customer care (ADR-0026 D6): owns quality_escalations, support_tickets, ticket_messages and
 * equipment_claims. Booking status changes go through BookingsService (the state machine); money
 * outcomes leave as `booking.needs_review` outbox events for "To settle". Staff reach it through
 * the admin desks; clients raise tickets and report quality issues through ClientCareController
 * (ADR-0027 D5).
 */
@Module({
  imports: [IdempotencyModule, BookingsModule],
  controllers: [ClientCareController],
  providers: [
    QualityEscalationsRepository,
    SupportTicketsRepository,
    EquipmentClaimsRepository,
    QualityService,
    TicketsService,
    ClaimsService,
  ],
  exports: [QualityService, TicketsService, ClaimsService],
})
export class CareModule {}
