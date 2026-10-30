import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { ClaimsService } from './claims.service';
import { QualityService } from './quality.service';
import { EquipmentClaimsRepository } from './repositories/equipment-claims.repository';
import { QualityEscalationsRepository } from './repositories/quality-escalations.repository';
import { SupportTicketsRepository } from './repositories/support-tickets.repository';
import { TicketsService } from './tickets.service';

/**
 * Customer care (ADR-0026 D6): owns quality_escalations, support_tickets, ticket_messages and
 * equipment_claims. Booking status changes go through BookingsService (the state machine); money
 * outcomes leave as `booking.needs_review` outbox events for "To settle". No controllers: staff
 * reach it through the admin desks.
 */
@Module({
  imports: [BookingsModule],
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
