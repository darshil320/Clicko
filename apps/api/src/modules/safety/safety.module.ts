import { Module } from '@nestjs/common';
import { ProGuard } from '../../common/guards/pro.guard';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PhotographersModule } from '../photographers/photographers.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { BlocksService } from './blocks.service';
import { ClientBlocksController } from './client-blocks.controller';
import { ClientReportsController } from './client-reports.controller';
import { ModerationService } from './moderation.service';
import { ProReportsController } from './pro-reports.controller';
import { ReportsService } from './reports.service';
import { BlocksRepository } from './repositories/blocks.repository';
import { ModerationActionsRepository } from './repositories/moderation-actions.repository';
import { ReportsRepository } from './repositories/reports.repository';

/**
 * UGC safety (ADR-0027 D4): owns moderation_reports, moderation_actions (append-only) and
 * client_photographer_blocks. Clients and photographers report; clients block; staff decide on
 * the admin moderation desk (ModerationService, used by the AdminModule). Dispatch reads blocks
 * through ClientBlocksReaderModule, never this module (which itself needs dispatch's
 * AssignmentReads for "worked on your booking").
 */
@Module({
  imports: [TokenModule, BookingsModule, DispatchModule, PhotographersModule, ReviewsModule],
  controllers: [ClientReportsController, ProReportsController, ClientBlocksController],
  providers: [
    ProGuard,
    ReportsRepository,
    ModerationActionsRepository,
    BlocksRepository,
    ReportsService,
    BlocksService,
    ModerationService,
  ],
  exports: [ReportsService, ModerationService],
})
export class SafetyModule {}
