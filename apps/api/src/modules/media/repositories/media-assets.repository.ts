import type { AssetKind } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { FolderFill } from '../../../infra/storage/folder-layout';
import type { Db, DeliveryInventory, MediaAssetRecord, NewMediaAsset, Tx } from '../media.types';

interface Row {
  id: string;
  booking_id: string;
  upload_session_id: string | null;
  kind: AssetKind;
  storage_object_id: string;
  storage_path: string;
  storage_adapter: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: string;
  checksum_md5: string;
  checksum_verified_at: Date | null;
  derived_from_asset_id: string | null;
}

const COLUMNS = `id, booking_id, upload_session_id, kind, storage_object_id, storage_path, storage_adapter,
  original_filename, mime_type, size_bytes, checksum_md5, checksum_verified_at, derived_from_asset_id`;

const toRecord = (r: Row): MediaAssetRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  uploadSessionId: r.upload_session_id,
  kind: r.kind,
  storageObjectId: r.storage_object_id,
  storagePath: r.storage_path,
  storageAdapter: r.storage_adapter,
  originalFilename: r.original_filename,
  mimeType: r.mime_type,
  sizeBytes: Number(r.size_bytes),
  checksumMd5: r.checksum_md5,
  checksumVerifiedAt: r.checksum_verified_at,
  derivedFromAssetId: r.derived_from_asset_id,
});

export interface BookingMediaCounts {
  readonly rawFiles: number;
  readonly jpegFiles: number;
  readonly videoFiles: number;
  readonly exportedJpegs: number;
  readonly uploadedBytes: number;
}

const EMPTY_COUNTS: BookingMediaCounts = {
  rawFiles: 0,
  jpegFiles: 0,
  videoFiles: 0,
  exportedJpegs: 0,
  uploadedBytes: 0,
};

/**
 * media_assets — owned by media. `purge_after` is never written here: S8 sets it from delivered_at
 * (Invariant 7). Aborted-session files are deleted for good and keep their row with `purged_at`.
 */
@Injectable()
export class MediaAssetsRepository {
  async insert(tx: Tx, a: NewMediaAsset): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO media_assets (booking_id, upload_session_id, kind, storage_object_id, storage_path,
        storage_adapter, original_filename, mime_type, size_bytes, checksum_md5, checksum_verified_at,
        derived_from_asset_id, width_px, height_px, created_at)
      VALUES (${a.bookingId}, ${a.uploadSessionId}, ${a.kind}, ${a.storageObjectId}, ${a.storagePath},
        ${a.storageAdapter}, ${a.originalFilename}, ${a.mimeType}, ${a.sizeBytes}, ${a.checksumMd5},
        ${a.checksumVerifiedAt}, ${a.derivedFromAssetId}, ${a.widthPx}, ${a.heightPx}, ${a.createdAt})
      RETURNING id`;
    if (!row) throw new Error('media_assets.insert: no row returned');
    return row.id;
  }

  async unpurgedForSession(db: Db, sessionId: string): Promise<MediaAssetRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM media_assets
      WHERE upload_session_id = ${sessionId} AND purged_at IS NULL`;
    return rows.map(toRecord);
  }

  /** Delivered files: unpurged, checksum-verified, by kind (ADR-0016 D1). */
  async inventory(db: Db, bookingId: string): Promise<DeliveryInventory> {
    const rows = await db<{ kind: AssetKind; files: number; bytes: string }[]>`
      SELECT kind, count(*)::int AS files, coalesce(sum(size_bytes), 0)::text AS bytes
      FROM media_assets
      WHERE booking_id = ${bookingId} AND purged_at IS NULL AND checksum_verified_at IS NOT NULL
        AND kind IN ('RAW_PHOTO', 'JPEG_PHOTO', 'VIDEO')
      GROUP BY kind`;
    const of = (kind: AssetKind) => {
      const r = rows.find((x) => x.kind === kind);
      return { files: r?.files ?? 0, bytes: Number(r?.bytes ?? 0) };
    };
    return { raw: of('RAW_PHOTO'), jpeg: of('JPEG_PHOTO'), video: of('VIDEO') };
  }

  /** Invariant 7: retention from delivery — RAW +7 d, JPEG/VIDEO +30 d (ADR-0016 D5). */
  async schedulePurge(tx: Tx, bookingId: string, rawAt: Date, jpegAt: Date): Promise<void> {
    await tx`
      UPDATE media_assets
         SET purge_after = CASE WHEN kind = 'RAW_PHOTO' THEN ${rawAt}::timestamptz ELSE ${jpegAt}::timestamptz END
       WHERE booking_id = ${bookingId} AND purged_at IS NULL`;
  }

  /** Unpurged assets of these kinds (every kind when `kinds` is empty). */
  async unpurgedOfKinds(
    db: Db,
    bookingId: string,
    kinds: readonly AssetKind[],
  ): Promise<MediaAssetRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM media_assets r
      WHERE r.booking_id = ${bookingId} AND r.purged_at IS NULL
        AND (${kinds.length === 0} OR r.kind = ANY(${db.array([...kinds])}::asset_kind[]))
      ORDER BY r.id`;
    return rows.map(toRecord);
  }

  async markPurged(tx: Tx, assetIds: readonly string[], now: Date): Promise<void> {
    if (assetIds.length === 0) return;
    await tx`UPDATE media_assets SET purged_at = ${now} WHERE id IN ${tx([...assetIds])} AND purged_at IS NULL`;
  }

  /** Bytes already in each `Photos-RAW/part-NN` folder of the booking (folder planning). */
  async rawFolderFills(db: Db, bookingId: string): Promise<FolderFill[]> {
    const rows = await db<{ folder: string | null; bytes: string }[]>`
      SELECT substring(storage_path from '(Photos-RAW/part-[0-9]+)/[^/]+$') AS folder,
             sum(size_bytes) AS bytes
      FROM media_assets
      WHERE booking_id = ${bookingId} AND kind = 'RAW_PHOTO' AND purged_at IS NULL
      GROUP BY 1`;
    return rows.flatMap((r) => (r.folder ? [{ folder: r.folder, bytes: Number(r.bytes) }] : []));
  }

  /**
   * Verified RAW originals that have no derived JPEG yet (the export worklist), by file name.
   * `exclude`: files that already failed in this run (security review M6).
   */
  async rawWithoutExport(
    db: Db,
    bookingId: string,
    limit: number,
    exclude: readonly string[] = [],
  ): Promise<MediaAssetRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM media_assets r
      WHERE r.booking_id = ${bookingId} AND r.kind = 'RAW_PHOTO' AND r.purged_at IS NULL
        AND r.checksum_verified_at IS NOT NULL
        AND NOT (r.id = ANY(${db.array([...exclude])}::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM media_assets d WHERE d.derived_from_asset_id = r.id)
      ORDER BY r.original_filename, r.id
      LIMIT ${limit}`;
    return rows.map(toRecord);
  }

  /** Serialises two exports of one RAW; returns whether a derived JPEG already exists. */
  async lockDerivation(tx: Tx, rawAssetId: string): Promise<boolean> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`jpeg-export:${rawAssetId}`}))`;
    const [row] = await tx`SELECT 1 FROM media_assets WHERE derived_from_asset_id = ${rawAssetId}`;
    return row !== undefined;
  }

  async exportSummary(
    db: Db,
    bookingId: string,
  ): Promise<{ raw: number; exported: number; placeholders: number }> {
    const [row] = await db<{ raw: string; exported: string; placeholders: string }[]>`
      SELECT count(*) FILTER (WHERE kind = 'RAW_PHOTO') AS raw,
             count(*) FILTER (WHERE derived_from_asset_id IS NOT NULL) AS exported,
             count(*) FILTER (WHERE derived_from_asset_id IS NOT NULL
                              AND original_filename LIKE '%.export-pending.jpg') AS placeholders
      FROM media_assets WHERE booking_id = ${bookingId} AND purged_at IS NULL`;
    return {
      raw: Number(row?.raw ?? 0),
      exported: Number(row?.exported ?? 0),
      placeholders: Number(row?.placeholders ?? 0),
    };
  }

  async countsForBookings(
    db: Db,
    bookingIds: readonly string[],
  ): Promise<Map<string, BookingMediaCounts>> {
    const counts = new Map<string, BookingMediaCounts>(bookingIds.map((id) => [id, EMPTY_COUNTS]));
    if (bookingIds.length === 0) return counts;
    const rows = await db<
      {
        booking_id: string;
        raw: string;
        jpeg: string;
        video: string;
        exported: string;
        bytes: string | null;
      }[]
    >`
      SELECT booking_id,
             count(*) FILTER (WHERE kind = 'RAW_PHOTO') AS raw,
             count(*) FILTER (WHERE kind = 'JPEG_PHOTO' AND derived_from_asset_id IS NULL) AS jpeg,
             count(*) FILTER (WHERE kind = 'VIDEO') AS video,
             count(*) FILTER (WHERE derived_from_asset_id IS NOT NULL) AS exported,
             sum(size_bytes) FILTER (WHERE derived_from_asset_id IS NULL) AS bytes
      FROM media_assets
      WHERE booking_id IN ${db([...bookingIds])} AND purged_at IS NULL
      GROUP BY booking_id`;
    for (const r of rows) {
      counts.set(r.booking_id, {
        rawFiles: Number(r.raw),
        jpegFiles: Number(r.jpeg),
        videoFiles: Number(r.video),
        exportedJpegs: Number(r.exported),
        uploadedBytes: Number(r.bytes ?? 0),
      });
    }
    return counts;
  }

  /** Every stored, unpurged asset of a booking (originals and derived) — the audit's DB side. */
  async unpurgedForBooking(db: Db, bookingId: string): Promise<MediaAssetRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM media_assets
      WHERE booking_id = ${bookingId} AND purged_at IS NULL`;
    return rows.map(toRecord);
  }

  /** Originals of COMPLETED sessions, split into verified-unpurged and purged (the audit's counts). */
  async originalCounts(db: Db, bookingId: string): Promise<{ stored: number; purged: number }> {
    const [row] = await db<{ stored: string; purged: string }[]>`
      SELECT count(*) FILTER (WHERE a.purged_at IS NULL AND a.checksum_verified_at IS NOT NULL) AS stored,
             count(*) FILTER (WHERE a.purged_at IS NOT NULL) AS purged
      FROM media_assets a JOIN upload_sessions s ON s.id = a.upload_session_id
      WHERE a.booking_id = ${bookingId} AND s.status = 'COMPLETED' AND a.derived_from_asset_id IS NULL`;
    return { stored: Number(row?.stored ?? 0), purged: Number(row?.purged ?? 0) };
  }
}
