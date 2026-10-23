import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { frameStem } from '@clickco/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { folderFor, yearMonthIst } from '../../infra/storage/folder-layout';
import {
  STORAGE_PORT,
  type StoragePort,
  type StoredObject,
} from '../../infra/storage/storage.port';
import { BookingsService } from '../bookings/bookings.service';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import {
  JPEG_EXPORT_PORT,
  type JpegExportPort,
  type JpegExportResult,
} from './export/jpeg-export.port';
import { MEDIA_CONFIG } from './media.config';
import type { MediaAssetRecord, UploadBookingFacts } from './media.types';
import { appendMediaAlert } from './ops-alert';
import { MediaAssetsRepository } from './repositories/media-assets.repository';
import { UploadBookings } from './upload-bookings';

/** The marker a passthrough placeholder carries in its row (ADR-0014 D4). */
export const PLACEHOLDER_SUFFIX = '.export-pending.jpg';

export type ExportOutcome =
  | { readonly kind: 'NOT_PROCESSING'; readonly status: string | null }
  | { readonly kind: 'EXPORTED'; readonly exported: number; readonly movedToQa: boolean };

/**
 * The `media.jpeg-export` job (ADR-0014 D4): every verified RAW of a PROCESSING booking gets a
 * derived full-resolution JPEG (darktable-cli), then PROCESSING → QA. Re-runnable: RAWs that already
 * have a derived JPEG are skipped, so a retry resumes where the last attempt stopped.
 */
@Injectable()
export class JpegExportService {
  private readonly logger = new Logger(JpegExportService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(JPEG_EXPORT_PORT) private readonly exporter: JpegExportPort,
    @Inject(BookingsService) private readonly bookingsService: BookingsService,
    @Inject(UploadBookings) private readonly bookings: UploadBookings,
    @Inject(MediaAssetsRepository) private readonly assets: MediaAssetsRepository,
  ) {}

  async exportBooking(bookingId: string): Promise<ExportOutcome> {
    const booking = await this.bookings.one(bookingId);
    if (booking?.status !== 'PROCESSING') {
      return { kind: 'NOT_PROCESSING', status: booking?.status ?? null };
    }
    let exported = 0;
    for (;;) {
      const batch = await this.assets.rawWithoutExport(
        this.sql,
        bookingId,
        MEDIA_CONFIG.exportBatch,
      );
      if (batch.length === 0) break;
      for (const raw of batch) {
        await this.exportOne(booking, raw);
        exported += 1;
      }
    }
    return { kind: 'EXPORTED', exported, movedToQa: await this.moveToQa(bookingId) };
  }

  private async exportOne(booking: UploadBookingFacts, raw: MediaAssetRecord): Promise<void> {
    const work = await mkdtemp(join(tmpdir(), 'clickco-export-'));
    try {
      const inputPath = join(work, `in${extname(raw.originalFilename).toLowerCase()}`);
      const outputPath = join(work, 'out.jpg');
      await pipeline(
        await this.storage.openObject(raw.storageObjectId),
        createWriteStream(inputPath),
      );
      let result: JpegExportResult;
      try {
        result = await this.exporter.exportRaw({ inputPath, outputPath });
      } catch (error) {
        await this.alertFailure(booking.bookingId, raw, error);
        throw error;
      }
      const fileName = `${frameStem(raw.originalFilename)}${result.isPlaceholder ? PLACEHOLDER_SUFFIX : '.jpg'}`;
      const stored = await this.storage.putObject(
        {
          bookingId: booking.bookingId,
          bookingRef: booking.reference,
          yearMonth: yearMonthIst(booking.scheduledStart),
          relativePath: `${folderFor('JPEG')}/${fileName}`,
          fileName,
          contentType: 'image/jpeg',
          kind: 'JPEG',
          sizeBytes: result.sizeBytes,
        },
        createReadStream(outputPath),
      );
      await this.recordDerived(raw, fileName, stored, result);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  private async recordDerived(
    raw: MediaAssetRecord,
    fileName: string,
    stored: StoredObject,
    result: JpegExportResult,
  ): Promise<void> {
    const now = this.clock();
    const duplicate = await this.sql.begin(async (tx) => {
      if (await this.assets.lockDerivation(tx, raw.id)) return true;
      await this.assets.insert(tx, {
        bookingId: raw.bookingId,
        uploadSessionId: raw.uploadSessionId,
        kind: 'JPEG_PHOTO',
        storageObjectId: stored.objectId,
        storagePath: stored.path,
        storageAdapter: this.storage.adapterId,
        originalFilename: fileName,
        mimeType: 'image/jpeg',
        sizeBytes: stored.sizeBytes,
        checksumMd5: stored.md5,
        checksumVerifiedAt: now,
        derivedFromAssetId: raw.id,
        widthPx: result.widthPx,
        heightPx: result.heightPx,
        createdAt: now,
      });
      return false;
    });
    // Another run exported this RAW first: drop the surplus copy (permanent delete, Invariant 6).
    if (duplicate) await this.storage.permanentlyDelete([stored.objectId]);
  }

  /** PROCESSING → QA once nothing is left to export (re-checked under the booking lock). */
  private async moveToQa(bookingId: string): Promise<boolean> {
    const summary = await this.assets.exportSummary(this.sql, bookingId);
    const now = this.clock();
    return this.sql.begin(async (tx) => {
      const booking = await this.bookingsService.lock(tx, bookingId);
      if (booking.status !== 'PROCESSING') return false;
      const remaining = await this.assets.rawWithoutExport(tx, bookingId, 1);
      if (remaining.length > 0) return false;
      await this.bookingsService.transition(tx, {
        bookingId,
        to: 'QA',
        actor: SYSTEM_ACTOR,
        occurredAt: now,
        reason: 'JPEG export complete',
        metadata: { exporter: this.exporter.id },
        payload: {
          raw_files: summary.raw,
          exported_jpegs: summary.exported,
          placeholder_exports: summary.placeholders,
          exporter: this.exporter.id,
        },
      });
      return true;
    });
  }

  private async alertFailure(bookingId: string, raw: MediaAssetRecord, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `JPEG export failed for ${raw.originalFilename} (booking ${bookingId}): ${message}`,
    );
    await this.sql
      .begin((tx) =>
        appendMediaAlert(tx, {
          aggregateKind: 'booking',
          aggregateId: bookingId,
          severity: 'HIGH',
          sourceEventType: 'media.jpeg_export_failed',
          dedupeKey: `jpeg-export-failed:${raw.id}`,
          details: {
            asset_id: raw.id,
            file_name: raw.originalFilename,
            exporter: this.exporter.id,
            error: message.slice(0, 500),
          },
          occurredAt: this.clock(),
        }),
      )
      .catch(() => undefined);
  }
}
