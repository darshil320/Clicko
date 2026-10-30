import type { ApplicationStage, PhotographerStatus, PlanTier } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { IdSubquery } from '../../../infra/db/id-subquery';
import type {
  CategoryRecord,
  CityScope,
  DirectoryFilter,
  DirectoryRecord,
  MetricsRecord,
  PenaltyRecord,
  ProfileRecord,
  Tx,
  VerificationRecord,
} from '../supply.types';
import {
  and,
  cityClause,
  type Db,
  personSearch,
  toVerification,
  VERIFICATION_COLUMNS,
  type VerificationRow,
} from './supply-rows';

interface DirectoryRow {
  id: string;
  full_name: string;
  phone_e164: string;
  city_id: string;
  status: PhotographerStatus;
  max_tier: PlanTier;
  rating_avg_bps: number | null;
  shoots_completed: number | null;
  active_penalties: number;
  onboarded_at: Date | null;
}

const toRow = (r: DirectoryRow): DirectoryRecord => ({
  id: r.id,
  fullName: r.full_name,
  phone: r.phone_e164,
  cityId: r.city_id,
  status: r.status,
  maxTier: r.max_tier,
  ratingAvgBps: r.rating_avg_bps,
  shootsCompleted: r.shoots_completed ?? 0,
  activePenalties: r.active_penalties,
  onboardedAt: r.onboarded_at,
});

const DIRECTORY_COLUMNS = `p.id, p.full_name, p.phone_e164, p.city_id, p.status, p.max_tier,
  m.rating_avg_bps, m.shoots_completed, p.onboarded_at,
  (SELECT count(*)::int FROM photographer_penalties x
   WHERE x.photographer_id = p.id AND NOT x.waived) AS active_penalties`;

interface PenaltyRow {
  id: string;
  photographer_id: string;
  booking_id: string | null;
  kind: string;
  severity: number;
  payout_deduction_bps: number;
  deactivation_days: number | null;
  waived: boolean;
  waive_reason: string | null;
  note: string | null;
  created_at: Date;
}

const toPenalty = (r: PenaltyRow): PenaltyRecord => ({
  id: r.id,
  photographerId: r.photographer_id,
  bookingId: r.booking_id,
  kind: r.kind,
  severity: r.severity,
  payoutDeductionBps: r.payout_deduction_bps,
  deactivationDays: r.deactivation_days,
  waived: r.waived,
  waiveReason: r.waive_reason,
  note: r.note,
  createdAt: r.created_at,
});

export interface PhotographerLock {
  readonly id: string;
  readonly cityId: string;
  readonly status: PhotographerStatus;
  readonly verification: VerificationRecord;
}

type ProfileBase = Omit<
  ProfileRecord,
  'categories' | 'metrics' | 'penalties' | 'documents' | 'application'
>;

/**
 * The photographer directory: photographers, photographer_metrics (read), photographer_categories
 * (read), photographer_penalties (waivers) and status changes. Reads the categories catalogue for
 * codes and names only.
 */
@Injectable()
export class DirectoryRepository {
  async page(db: Db, f: DirectoryFilter): Promise<DirectoryRecord[]> {
    const where = [
      cityClause(db, f.scope),
      ...(f.cityId ? [db`p.city_id = ${f.cityId}`] : []),
      ...(f.status ? [db`p.status = ${f.status}`] : []),
      ...(f.search ? [personSearch(db, f.search, f.searchPhones)] : []),
      ...(f.after ? [db`(p.full_name, p.id) > (${f.after.fullName}, ${f.after.id}::uuid)`] : []),
    ];
    const rows = await db<DirectoryRow[]>`
      SELECT ${db.unsafe(DIRECTORY_COLUMNS)}
      FROM photographers p LEFT JOIN photographer_metrics m ON m.photographer_id = p.id
      WHERE ${and(db, where)}
      ORDER BY p.full_name, p.id
      LIMIT ${f.limit}`;
    return rows.map(toRow);
  }

  async profileBase(db: Db, id: string): Promise<ProfileBase | null> {
    const [row] = await db<
      Array<
        DirectoryRow &
          VerificationRow & {
            email: string | null;
            service_radius_km: number;
            accepts_emergency: boolean;
            accepts_outstation: boolean;
            suspended_at: Date | null;
            suspension_reason: string | null;
            offboarded_at: Date | null;
          }
      >
    >`
      SELECT ${db.unsafe(DIRECTORY_COLUMNS)}, p.email, p.service_radius_km::float8 AS service_radius_km,
             p.accepts_emergency, p.accepts_outstation, p.suspended_at, p.suspension_reason,
             p.offboarded_at, ${db.unsafe(VERIFICATION_COLUMNS)}
      FROM photographers p LEFT JOIN photographer_metrics m ON m.photographer_id = p.id
      WHERE p.id = ${id}`;
    if (!row) return null;
    return {
      ...toRow(row),
      email: row.email,
      serviceRadiusKm: row.service_radius_km,
      acceptsEmergency: row.accepts_emergency,
      acceptsOutstation: row.accepts_outstation,
      verification: toVerification(row),
      suspendedAt: row.suspended_at,
      suspensionReason: row.suspension_reason,
      offboardedAt: row.offboarded_at,
    };
  }

  async categories(db: Db, id: string): Promise<CategoryRecord[]> {
    const rows = await db<
      { code: string; name: string; certified_tier: PlanTier; certified_at: Date }[]
    >`
      SELECT c.code, c.name, pc.certified_tier, pc.certified_at
      FROM photographer_categories pc JOIN categories c ON c.id = pc.category_id
      WHERE pc.photographer_id = ${id} AND pc.revoked_at IS NULL
      ORDER BY c.sort_order, c.code`;
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      certifiedTier: r.certified_tier,
      certifiedAt: r.certified_at,
    }));
  }

  async metrics(db: Db, id: string): Promise<MetricsRecord | null> {
    const [r] = await db<
      {
        shoots_completed: number;
        rating_avg_bps: number | null;
        rating_count: number;
        acceptance_rate_bps: number | null;
        on_time_upload_rate_bps: number | null;
        no_show_count: number;
        data_loss_count: number;
        escalation_count: number;
        computed_at: Date;
      }[]
    >`SELECT * FROM photographer_metrics WHERE photographer_id = ${id}`;
    if (!r) return null;
    return {
      shootsCompleted: r.shoots_completed,
      ratingAvgBps: r.rating_avg_bps,
      ratingCount: r.rating_count,
      acceptanceRateBps: r.acceptance_rate_bps,
      onTimeUploadRateBps: r.on_time_upload_rate_bps,
      noShowCount: r.no_show_count,
      dataLossCount: r.data_loss_count,
      escalationCount: r.escalation_count,
      computedAt: r.computed_at,
    };
  }

  async penalties(db: Db, id: string): Promise<PenaltyRecord[]> {
    const rows = await db<PenaltyRow[]>`
      SELECT id, photographer_id, booking_id, kind, severity, payout_deduction_bps,
             deactivation_days, waived, waive_reason, note, created_at
      FROM photographer_penalties WHERE photographer_id = ${id}
      ORDER BY created_at DESC, id`;
    return rows.map(toPenalty);
  }

  async latestApplication(
    db: Db,
    id: string,
  ): Promise<{ id: string; stage: ApplicationStage } | null> {
    const [row] = await db<{ id: string; stage: ApplicationStage }[]>`
      SELECT id, stage FROM photographer_applications WHERE photographer_id = ${id}
      ORDER BY created_at DESC LIMIT 1`;
    return row ?? null;
  }

  async lockPenalty(tx: Tx, id: string): Promise<(PenaltyRecord & { cityId: string }) | null> {
    const [row] = await tx<Array<PenaltyRow & { city_id: string }>>`
      SELECT x.id, x.photographer_id, x.booking_id, x.kind, x.severity, x.payout_deduction_bps,
             x.deactivation_days, x.waived, x.waive_reason, x.note, x.created_at, p.city_id
      FROM photographer_penalties x JOIN photographers p ON p.id = x.photographer_id
      WHERE x.id = ${id}
      FOR UPDATE OF x`;
    return row ? { ...toPenalty(row), cityId: row.city_id } : null;
  }

  async waivePenalty(tx: Tx, id: string, reason: string): Promise<PenaltyRecord> {
    const [row] = await tx<PenaltyRow[]>`
      UPDATE photographer_penalties SET waived = TRUE, waive_reason = ${reason}
      WHERE id = ${id}
      RETURNING id, photographer_id, booking_id, kind, severity, payout_deduction_bps,
                deactivation_days, waived, waive_reason, note, created_at`;
    if (!row) throw new Error(`waivePenalty: ${id} vanished`);
    return toPenalty(row);
  }

  async lockPhotographer(tx: Tx, id: string): Promise<PhotographerLock | null> {
    const [row] = await tx<
      Array<VerificationRow & { id: string; city_id: string; status: PhotographerStatus }>
    >`
      SELECT p.id, p.city_id, p.status, ${tx.unsafe(VERIFICATION_COLUMNS)}
      FROM photographers p WHERE p.id = ${id} FOR UPDATE`;
    if (!row) return null;
    return {
      id: row.id,
      cityId: row.city_id,
      status: row.status,
      verification: toVerification(row),
    };
  }

  async setStatus(
    tx: Tx,
    id: string,
    s: { readonly to: PhotographerStatus; readonly reason: string; readonly at: Date },
  ): Promise<void> {
    if (s.to === 'SUSPENDED') {
      await tx`
        UPDATE photographers
        SET status = 'SUSPENDED', suspended_at = ${s.at}, suspension_reason = ${s.reason}
        WHERE id = ${id}`;
      return;
    }
    if (s.to === 'OFFBOARDED') {
      await tx`UPDATE photographers SET status = 'OFFBOARDED', offboarded_at = ${s.at} WHERE id = ${id}`;
      return;
    }
    await tx`UPDATE photographers SET status = ${s.to} WHERE id = ${id}`;
  }

  /** The city of a photographer (null when absent). */
  async cityOf(db: Db, id: string): Promise<string | null> {
    const [row] = await db<
      { city_id: string }[]
    >`SELECT city_id FROM photographers WHERE id = ${id}`;
    return row?.city_id ?? null;
  }

  /** `SELECT id FROM photographers WHERE city in scope` for another module's SQL filter. */
  idsInScope(db: Db, scope: CityScope): IdSubquery {
    return db`SELECT p.id FROM photographers p WHERE ${cityClause(db, scope)}`;
  }

  async idByPhone(db: Db, phone: string): Promise<string | null> {
    const [row] = await db<
      { id: string }[]
    >`SELECT id FROM photographers WHERE phone_e164 = ${phone}`;
    return row?.id ?? null;
  }
}
