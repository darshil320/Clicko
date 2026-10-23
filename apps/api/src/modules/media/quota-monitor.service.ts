import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { STORAGE_PORT, type StoragePort } from '../../infra/storage/storage.port';
import { MEDIA_CONFIG, STORAGE_AGGREGATE_ID } from './media.config';
import { type AlertSeverity, appendMediaAlert } from './ops-alert';
import { MediaOpsRepository, type QuotaSample } from './repositories/media-ops.repository';

/** Basis points of `limit` that `used` is, rounded down, in bigint (bytes × 10⁴ pass 2⁵³). */
export function shareBps(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Number((BigInt(used) * 10_000n) / BigInt(limit));
}

const SEVERITIES: readonly AlertSeverity[] = ['MEDIUM', 'HIGH', 'CRITICAL'];

/** The highest 60/75/90 % band reached (-1 below 60 %). */
export function storageBand(bps: number): number {
  return MEDIA_CONFIG.storageAlertBps.reduce((band, t, i) => (bps >= t ? i : band), -1);
}

export interface QuotaAlertPlan {
  readonly storage: { readonly severity: AlertSeverity; readonly thresholdBps: number } | null;
  readonly daily: boolean;
}

/** Alerts fire on the crossing only, compared with the previous sample (ADR-0014 D5). */
export function planQuotaAlerts(
  previous: Pick<
    QuotaSample,
    'usedBytes' | 'limitBytes' | 'dailyUploadedBytes' | 'dailyLimitBytes'
  > | null,
  current: Pick<QuotaSample, 'usedBytes' | 'limitBytes' | 'dailyUploadedBytes' | 'dailyLimitBytes'>,
): QuotaAlertPlan {
  const before = previous ? storageBand(shareBps(previous.usedBytes, previous.limitBytes)) : -1;
  const now = storageBand(shareBps(current.usedBytes, current.limitBytes));
  const storage =
    now > before
      ? {
          severity: SEVERITIES[now] as AlertSeverity,
          thresholdBps: MEDIA_CONFIG.storageAlertBps[now] as number,
        }
      : null;
  const dailyBps = (s: typeof current | null) =>
    s?.dailyLimitBytes ? shareBps(s.dailyUploadedBytes, s.dailyLimitBytes) : 0;
  const daily =
    dailyBps(current) >= MEDIA_CONFIG.dailyCeilingRefuseBps &&
    dailyBps(previous) < MEDIA_CONFIG.dailyCeilingRefuseBps;
  return { storage, daily };
}

/** The `media.quota-monitor` job (every 15 min): a storage_quota_samples row + crossing alerts. */
@Injectable()
export class QuotaMonitorService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(MediaOpsRepository) private readonly ops: MediaOpsRepository,
  ) {}

  async sample(): Promise<{ sample: QuotaSample; plan: QuotaAlertPlan }> {
    const usage = await this.storage.getUsage();
    const adapter = this.storage.adapterId;
    const now = this.clock();
    return this.sql.begin(async (tx) => {
      // Serialises two monitor runs so a crossing is alerted once.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`quota-monitor:${adapter}`}))`;
      const previous = await this.ops.latestSample(tx, adapter);
      const sample = await this.ops.insertSample(tx, {
        adapter,
        usedBytes: usage.usedBytes,
        limitBytes: usage.limitBytes,
        dailyUploadedBytes: usage.dailyUploadedBytes,
        dailyLimitBytes: usage.dailyLimitBytes,
        sampledAt: now,
      });
      const plan = planQuotaAlerts(previous, sample);
      const details = {
        sample_id: sample.id,
        used_bytes: sample.usedBytes,
        limit_bytes: sample.limitBytes,
        used_bps: shareBps(sample.usedBytes, sample.limitBytes),
        daily_uploaded_bytes: sample.dailyUploadedBytes,
        daily_limit_bytes: sample.dailyLimitBytes,
      };
      const aggregateId = STORAGE_AGGREGATE_ID[adapter] as string;
      if (plan.storage) {
        await appendMediaAlert(tx, {
          aggregateKind: 'storage',
          aggregateId,
          severity: plan.storage.severity,
          sourceEventType: 'storage.quota_threshold',
          dedupeKey: `quota:${sample.id}`,
          details: { ...details, threshold_bps: plan.storage.thresholdBps },
          occurredAt: now,
        });
      }
      if (plan.daily) {
        await appendMediaAlert(tx, {
          aggregateKind: 'storage',
          aggregateId,
          severity: 'HIGH',
          sourceEventType: 'storage.daily_ceiling_reached',
          dedupeKey: `quota-daily:${sample.id}`,
          details: { ...details, threshold_bps: MEDIA_CONFIG.dailyCeilingRefuseBps },
          occurredAt: now,
        });
      }
      return { sample, plan };
    });
  }
}
