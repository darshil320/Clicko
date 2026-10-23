import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { Db, Tx } from '../media.types';

export type AuditResult = 'OK' | 'MISMATCH' | 'PROVIDER_ERROR';

export interface NewIntegrityAudit {
  readonly bookingId: string;
  readonly expectedCount: number;
  readonly dbCount: number;
  readonly providerCount: number;
  readonly checksumMismatches: number;
  readonly result: AuditResult;
  readonly detail: Readonly<Record<string, postgres.JSONValue>>;
  readonly ranAt: Date;
}

export interface QuotaSample {
  readonly id: string;
  readonly adapter: string;
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly dailyUploadedBytes: number;
  readonly dailyLimitBytes: number | null;
  readonly sampledAt: Date;
}

interface SampleRow {
  id: string;
  adapter: string;
  used_bytes: string;
  limit_bytes: string;
  daily_uploaded_bytes: string;
  daily_limit_bytes: string | null;
  sampled_at: Date;
}

const toSample = (r: SampleRow): QuotaSample => ({
  id: r.id,
  adapter: r.adapter,
  usedBytes: Number(r.used_bytes),
  limitBytes: Number(r.limit_bytes),
  dailyUploadedBytes: Number(r.daily_uploaded_bytes),
  dailyLimitBytes: r.daily_limit_bytes === null ? null : Number(r.daily_limit_bytes),
  sampledAt: r.sampled_at,
});

/**
 * media_integrity_audits and storage_quota_samples (owned by media), plus a read of feature_flags —
 * a platform table with no owning module yet (the admin flag editor is S9).
 */
@Injectable()
export class MediaOpsRepository {
  async insertAudit(tx: Tx, a: NewIntegrityAudit): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO media_integrity_audits (booking_id, expected_count, db_count, provider_count,
        checksum_mismatches, result, detail, ran_at)
      VALUES (${a.bookingId}, ${a.expectedCount}, ${a.dbCount}, ${a.providerCount},
        ${a.checksumMismatches}, ${a.result}, ${tx.json(a.detail as postgres.JSONValue)}, ${a.ranAt})
      RETURNING id`;
    if (!row) throw new Error('media_integrity_audits.insert: no row returned');
    return row.id;
  }

  async latestSample(db: Db, adapter: string): Promise<QuotaSample | null> {
    const [row] = await db<SampleRow[]>`
      SELECT id, adapter, used_bytes, limit_bytes, daily_uploaded_bytes, daily_limit_bytes, sampled_at
      FROM storage_quota_samples WHERE adapter = ${adapter}
      ORDER BY sampled_at DESC, id DESC LIMIT 1`;
    return row ? toSample(row) : null;
  }

  async insertSample(tx: Tx, s: Omit<QuotaSample, 'id'>): Promise<QuotaSample> {
    const [row] = await tx<SampleRow[]>`
      INSERT INTO storage_quota_samples (adapter, used_bytes, limit_bytes, daily_uploaded_bytes,
        daily_limit_bytes, sampled_at)
      VALUES (${s.adapter}, ${s.usedBytes}, ${s.limitBytes}, ${s.dailyUploadedBytes},
        ${s.dailyLimitBytes}, ${s.sampledAt})
      RETURNING id, adapter, used_bytes, limit_bytes, daily_uploaded_bytes, daily_limit_bytes, sampled_at`;
    if (!row) throw new Error('storage_quota_samples.insert: no row returned');
    return toSample(row);
  }

  /** `is_enabled`, and the city listed when `enabled_cities` is set (rollout_bps unused — ADR-0014). */
  async flagEnabled(db: Db, key: string, cityId: string): Promise<boolean> {
    const [row] = await db<{ on: boolean }[]>`
      SELECT is_enabled AND (enabled_cities IS NULL OR ${cityId}::uuid = ANY (enabled_cities)) AS on
      FROM feature_flags WHERE key = ${key}`;
    return row?.on === true;
  }
}
