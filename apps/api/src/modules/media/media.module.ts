import { Module } from '@nestjs/common';
import { ProGuard } from '../../common/guards/pro.guard';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { ENV, type Env } from '../../config/env';
import { StorageModule } from '../../infra/storage/storage.module';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PhotographersModule } from '../photographers/photographers.module';
import { DarktableCliAdapter } from './export/darktable-cli.adapter';
import { DevPassthroughAdapter } from './export/dev-passthrough.adapter';
import { JPEG_EXPORT_PORT, type JpegExportPort } from './export/jpeg-export.port';
import { IntegrityAuditService } from './integrity-audit.service';
import { JpegExportService } from './jpeg-export.service';
import { MEDIA_CONFIG } from './media.config';
import { MediaSubscribers } from './media.subscribers';
import { ProUploadsController } from './pro-uploads.controller';
import { QuotaMonitorService } from './quota-monitor.service';
import { MediaAssetsRepository } from './repositories/media-assets.repository';
import { MediaOpsRepository } from './repositories/media-ops.repository';
import { UploadSessionsRepository } from './repositories/upload-sessions.repository';
import { UploadBookings } from './upload-bookings';
import { UploadJobsService } from './upload-jobs.service';
import { UploadPartsService } from './upload-parts.service';
import { UploadSessionsService } from './upload-sessions.service';

export function createJpegExporter(env: Env): JpegExportPort {
  return env.JPEG_EXPORT_ADAPTER === 'darktable'
    ? new DarktableCliAdapter({
        binary: env.DARKTABLE_CLI_PATH,
        timeoutMs: MEDIA_CONFIG.darktableTimeoutMs,
        quality: 92,
      })
    : new DevPassthroughAdapter();
}

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
  ],
  controllers: [ProUploadsController],
  providers: [
    ProGuard,
    { provide: JPEG_EXPORT_PORT, inject: [ENV], useFactory: createJpegExporter },
    UploadSessionsRepository,
    MediaAssetsRepository,
    MediaOpsRepository,
    UploadBookings,
    UploadSessionsService,
    UploadPartsService,
    UploadJobsService,
    JpegExportService,
    IntegrityAuditService,
    QuotaMonitorService,
    MediaSubscribers,
  ],
  exports: [JpegExportService, IntegrityAuditService, QuotaMonitorService],
})
export class MediaModule {}
