import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import {
  STORAGE_PORT,
  type StoragePort,
  type StoredObject,
} from '../../infra/storage/storage.port';
import { MEDIA_CONFIG } from './media.config';
import type { MediaAssetRecord } from './media.types';
import { appendMediaAlert } from './ops-alert';
import { MediaAssetsRepository } from './repositories/media-assets.repository';
import { type AuditResult, MediaOpsRepository } from './repositories/media-ops.repository';
import { UploadSessionsRepository } from './repositories/upload-sessions.repository';

export interface AuditFinding {
  readonly expectedCount: number;
  readonly dbCount: number;
  readonly providerCount: number;
  readonly checksumMismatches: number;
  readonly result: AuditResult;
  readonly missing: readonly string[];
  readonly orphans: readonly string[];
  readonly mismatched: readonly string[];
}

/**
 * Pure comparison (ADR-0014 D5): declared vs stored originals, and the DB's unpurged assets vs what
 * the provider lists — ids, sizes and MD5s.
 */
export function compareInventory(input: {
  readonly declared: number;
  readonly purgedOriginals: number;
  readonly storedOriginals: number;
  readonly dbAssets: readonly Pick<
    MediaAssetRecord,
    'storageObjectId' | 'sizeBytes' | 'checksumMd5'
  >[];
  readonly provider: readonly Pick<StoredObject, 'objectId' | 'sizeBytes' | 'md5'>[];
}): AuditFinding {
  const expected = input.declared - input.purgedOriginals;
  const providerById = new Map(input.provider.map((o) => [o.objectId, o]));
  const dbIds = new Set(input.dbAssets.map((a) => a.storageObjectId));
  const missing = input.dbAssets
    .filter((a) => !providerById.has(a.storageObjectId))
    .map((a) => a.storageObjectId);
  const orphans = input.provider.filter((o) => !dbIds.has(o.objectId)).map((o) => o.objectId);
  const mismatched = input.dbAssets
    .filter((a) => {
      const o = providerById.get(a.storageObjectId);
      return o !== undefined && (o.sizeBytes !== a.sizeBytes || o.md5 !== a.checksumMd5);
    })
    .map((a) => a.storageObjectId);
  const ok =
    expected === input.storedOriginals &&
    missing.length === 0 &&
    orphans.length === 0 &&
    mismatched.length === 0;
  return {
    expectedCount: expected,
    dbCount: input.storedOriginals,
    providerCount: input.provider.length,
    checksumMismatches: mismatched.length,
    result: ok ? 'OK' : 'MISMATCH',
    missing,
    orphans,
    mismatched,
  };
}

/** The weekly `media.integrity-audit` job: one media_integrity_audits row per booking. */
@Injectable()
export class IntegrityAuditService {
  private readonly logger = new Logger(IntegrityAuditService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(UploadSessionsRepository) private readonly sessions: UploadSessionsRepository,
    @Inject(MediaAssetsRepository) private readonly assets: MediaAssetsRepository,
    @Inject(MediaOpsRepository) private readonly ops: MediaOpsRepository,
  ) {}

  async auditAll(): Promise<{ audited: number; problems: number }> {
    const bookingIds = await this.sessions.bookingsToAudit(this.sql, MEDIA_CONFIG.auditBatch);
    let problems = 0;
    for (const bookingId of bookingIds) {
      const result = await this.auditBooking(bookingId);
      if (result !== 'OK') problems += 1;
    }
    return { audited: bookingIds.length, problems };
  }

  async auditBooking(bookingId: string): Promise<AuditResult> {
    const declared = await this.sessions.declaredCompleted(this.sql, bookingId);
    const originals = await this.assets.originalCounts(this.sql, bookingId);
    const dbAssets = await this.assets.unpurgedForBooking(this.sql, bookingId);
    const now = this.clock();
    let finding: AuditFinding;
    let providerError: string | null = null;
    try {
      finding = compareInventory({
        declared,
        purgedOriginals: originals.purged,
        storedOriginals: originals.stored,
        dbAssets,
        provider: await this.storage.listObjects(bookingId),
      });
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Integrity audit could not list booking ${bookingId}: ${providerError}`);
      finding = {
        expectedCount: declared - originals.purged,
        dbCount: originals.stored,
        providerCount: 0,
        checksumMismatches: 0,
        result: 'PROVIDER_ERROR',
        missing: [],
        orphans: [],
        mismatched: [],
      };
    }
    const limit = MEDIA_CONFIG.auditDetailLimit;
    const detail = {
      db_assets: dbAssets.length,
      missing: finding.missing.slice(0, limit),
      orphans: finding.orphans.slice(0, limit),
      mismatched: finding.mismatched.slice(0, limit),
      ...(providerError ? { provider_error: providerError.slice(0, 500) } : {}),
    };
    await this.sql.begin(async (tx) => {
      const auditId = await this.ops.insertAudit(tx, {
        bookingId,
        expectedCount: finding.expectedCount,
        dbCount: finding.dbCount,
        providerCount: finding.providerCount,
        checksumMismatches: finding.checksumMismatches,
        result: finding.result,
        detail,
        ranAt: now,
      });
      if (finding.result !== 'OK') {
        await appendMediaAlert(tx, {
          aggregateKind: 'booking',
          aggregateId: bookingId,
          severity: 'HIGH',
          sourceEventType:
            finding.result === 'PROVIDER_ERROR'
              ? 'media.integrity_provider_error'
              : 'media.integrity_mismatch',
          dedupeKey: `integrity-audit:${auditId}`,
          details: {
            audit_id: auditId,
            expected_count: finding.expectedCount,
            db_count: finding.dbCount,
            provider_count: finding.providerCount,
            checksum_mismatches: finding.checksumMismatches,
          },
          occurredAt: now,
        });
      }
    });
    return finding.result;
  }
}
