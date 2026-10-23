import type { StorageUsage } from '../../infra/storage/storage.port';
import { MEDIA_CONFIG } from './media.config';

export type CapacityProblem = 'STORAGE_FULL' | 'STORAGE_DAILY_CEILING';

/** (a × 10000) > (b × bps), in bigint: byte counts × 10⁴ pass 2⁵³ on a 5 TB drive. */
export const exceedsShare = (a: number, b: number, bps: number): boolean =>
  BigInt(a) * 10_000n > BigInt(b) * BigInt(bps);

/**
 * Doc 02 §6 / ADR-0014 D1: a new session is refused when the declared bytes do not fit in the
 * remaining storage, or when today's uploads plus the declared bytes pass 85 % of the daily ceiling.
 */
export function capacityProblem(
  usage: StorageUsage,
  declaredBytes: number,
): CapacityProblem | null {
  if (usage.usedBytes + declaredBytes > usage.limitBytes) return 'STORAGE_FULL';
  if (
    usage.dailyLimitBytes !== null &&
    exceedsShare(
      usage.dailyUploadedBytes + declaredBytes,
      usage.dailyLimitBytes,
      MEDIA_CONFIG.dailyCeilingRefuseBps,
    )
  ) {
    return 'STORAGE_DAILY_CEILING';
  }
  return null;
}
