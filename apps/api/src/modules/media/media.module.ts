import { Module } from '@nestjs/common';
import { ProGuard } from '../../common/guards/pro.guard';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { StorageModule } from '../../infra/storage/storage.module';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PhotographersModule } from '../photographers/photographers.module';
import { IntegrityAuditService } from './integrity-audit.service';
import { MediaSubscribers } from './media.subscribers';
import { MediaExportModule } from './media-export.module';
import { MediaRetentionService } from './media-retention.service';
import { ProUploadsController } from './pro-uploads.controller';
import { QuotaMonitorService } from './quota-monitor.service';
import { MediaAssetsRepository } from './repositories/media-assets.repository';
import { MediaOpsRepository } from './repositories/media-ops.repository';
import { UploadSessionsRepository } from './repositories/upload-sessions.repository';
import { UploadBookings } from './upload-bookings';
import { UploadJobsService } from './upload-jobs.service';
import { UploadPartsService } from './upload-parts.service';
import { UploadReaperService } from './upload-reaper.service';
import { UploadSessionsService } from './upload-sessions.service';

/**
 * Owns upload_sessions, media_assets, media_integrity_audits and storage_quota_samples
 * (ADR-0014). Bytes go through StoragePort only (Invariants 24, 25); bookings change status through
 * BookingsService; assignments are read through dispatch's AssignmentReads. Processors for its jobs
 * live in src/jobs/.
 */
@Module({
  imports: [
    TokenModule,
    IdempotencyModule,
    PhotographersModule,
    BookingsModule,
    DispatchModule,
    StorageModule,
    MediaExportModule,
  ],
  controllers: [ProUploadsController],
  providers: [
    ProGuard,
    UploadSessionsRepository,
    MediaAssetsRepository,
    MediaOpsRepository,
    UploadBookings,
    UploadSessionsService,
    UploadPartsService,
    UploadJobsService,
    IntegrityAuditService,
    QuotaMonitorService,
    UploadReaperService,
    MediaRetentionService,
    MediaSubscribers,
  ],
  exports: [
    MediaExportModule,
    IntegrityAuditService,
    QuotaMonitorService,
    UploadReaperService,
    MediaRetentionService,
  ],
})
export class MediaModule {}
