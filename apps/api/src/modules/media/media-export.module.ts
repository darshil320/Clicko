import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { StorageModule } from '../../infra/storage/storage.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DarktableCliAdapter } from './export/darktable-cli.adapter';
import { DevPassthroughAdapter } from './export/dev-passthrough.adapter';
import { JPEG_EXPORT_PORT, type JpegExportPort } from './export/jpeg-export.port';
import { JpegExportService } from './jpeg-export.service';
import { MEDIA_CONFIG } from './media.config';
import { MediaAssetsRepository } from './repositories/media-assets.repository';
import { UploadBookings } from './upload-bookings';

export function createJpegExporter(env: Env): JpegExportPort {
  return env.JPEG_EXPORT_ADAPTER === 'darktable'
    ? new DarktableCliAdapter({
        binary: env.DARKTABLE_CLI_PATH,
        timeoutMs: MEDIA_CONFIG.darktableTimeoutMs,
        quality: 92,
        maxInputBytes: MEDIA_CONFIG.maxExportRawBytes,
        memoryLimitMb: MEDIA_CONFIG.darktableMemoryLimitMb,
      })
    : new DevPassthroughAdapter();
}

/**
 * RAW → JPEG export only (ADR-0014 D4), split out for audit H1: the separate media worker
 * (worker.ts) loads this and nothing that holds payment, signing or staff secrets — no payments,
 * dispatch, auth or admin modules. MediaModule imports it for the in-process (development) case.
 */
@Module({
  imports: [BookingsModule, StorageModule],
  providers: [
    { provide: JPEG_EXPORT_PORT, inject: [ENV], useFactory: createJpegExporter },
    UploadBookings,
    MediaAssetsRepository,
    JpegExportService,
  ],
  exports: [JpegExportService],
})
export class MediaExportModule {}
