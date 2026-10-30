import type { ApplicationStage, PhotographerStatus, PlanTier } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type {
  ApplicationCardRecord,
  ApplicationEventRecord,
  CityScope,
  NewApplicant,
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

interface CardRow {
  id: string;
  photographer_id: string;
  full_name: string;
  phone_e164: string;
  city_id: string;
  source: string | null;
  portfolio_url: string | null;
  years_experience: number | null;
  requested_max_tier: PlanTier | null;
  stage: ApplicationStage;
  stage_since: Date;
  created_at: Date;
  docs_pending: number;
  docs_approved: number;
  docs_rejected: number;
}

const toCard = (r: CardRow): ApplicationCardRecord => ({
  id: r.id,
  photographerId: r.photographer_id,
  fullName: r.full_name,
  phone: r.phone_e164,
  cityId: r.city_id,
  source: r.source,
  portfolioUrl: r.portfolio_url,
  yearsExperience: r.years_experience,
  requestedMaxTier: r.requested_max_tier,
  stage: r.stage,
  stageSince: r.stage_since,
  createdAt: r.created_at,
  documents: { pending: r.docs_pending, approved: r.docs_approved, rejected: r.docs_rejected },
});

/** The card's columns: applicant, when it entered its stage, and its document tally. */
function cardSelect(db: Db) {
  return db`
    SELECT a.id, a.photographer_id, p.full_name, p.phone_e164, p.city_id, a.source,
           a.portfolio_url, a.years_experience, a.requested_max_tier, a.stage,
           coalesce(s.at, a.created_at) AS stage_since, a.created_at,
           coalesce(dc.pending, 0) AS docs_pending, coalesce(dc.approved, 0) AS docs_approved,
           coalesce(dc.rejected, 0) AS docs_rejected
    FROM photographer_applications a
    JOIN photographers p ON p.id = a.photographer_id
    LEFT JOIN LATERAL (
      SELECT e.created_at AS at FROM photographer_application_events e
      WHERE e.application_id = a.id AND e.to_stage = a.stage
      ORDER BY e.created_at DESC LIMIT 1) s ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE d.review_status = 'PENDING')::int AS pending,
             count(*) FILTER (WHERE d.review_status = 'APPROVED')::int AS approved,
             count(*) FILTER (WHERE d.review_status IN ('REJECTED', 'RESUBMIT_REQUESTED'))::int
               AS rejected
      FROM photographer_documents d
      WHERE d.photographer_id = p.id AND d.purged_at IS NULL) dc ON TRUE`;
}

export interface BoardQuery {
  readonly scope: CityScope;
  readonly cityId?: string;
  readonly search?: string;
  readonly searchPhones: boolean;
  readonly boardStages: readonly ApplicationStage[];
  readonly closedStages: readonly ApplicationStage[];
  /** Closed stages show only what closed at or after this. */
  readonly closedSince: Date;
  readonly perStage: number;
}

export interface ApplicationLock {
  readonly id: string;
  readonly photographerId: string;
  readonly cityId: string;
  readonly stage: ApplicationStage;
  readonly photographerStatus: PhotographerStatus;
  readonly verification: VerificationRecord;
}

export interface ApplicationExtras {
  readonly photographerStatus: PhotographerStatus;
  readonly declaredGear: string | null;
  readonly interviewAt: Date | null;
  readonly interviewNotes: string | null;
  readonly decisionReason: string | null;
  readonly decidedAt: Date | null;
  readonly verification: VerificationRecord;
}

/**
 * photographer_applications and photographer_application_events (append-only, Invariant 5),
 * plus the photographers row an applicant starts as. Owned by the photographers module.
 */
@Injectable()
export class OnboardingRepository {
  /** Every stage's count and its longest-waiting `perStage` cards, in one pass. */
  async board(db: Db, q: BoardQuery): Promise<Array<ApplicationCardRecord & { total: number }>> {
    const where = [
      cityClause(db, q.scope),
      ...(q.cityId ? [db`p.city_id = ${q.cityId}`] : []),
      ...(q.search ? [personSearch(db, q.search, q.searchPhones)] : []),
      db`(c.stage IN ${db([...q.boardStages])}
          OR (c.stage IN ${db([...q.closedStages])} AND c.stage_since >= ${q.closedSince}))`,
    ];
    const rows = await db<Array<CardRow & { total: number }>>`
      SELECT * FROM (
        SELECT c.*, row_number() OVER (PARTITION BY c.stage ORDER BY c.stage_since, c.id) AS rn,
               (count(*) OVER (PARTITION BY c.stage))::int AS total
        FROM (${cardSelect(db)}) c
        JOIN photographers p ON p.id = c.photographer_id
        WHERE ${and(db, where)}
      ) ranked
      WHERE ranked.rn <= ${q.perStage}
      ORDER BY ranked.stage, ranked.rn`;
    return rows.map((r) => ({ ...toCard(r), total: r.total }));
  }

  async card(db: Db, id: string): Promise<ApplicationCardRecord | null> {
    const [row] = await db<CardRow[]>`SELECT c.* FROM (${cardSelect(db)}) c WHERE c.id = ${id}`;
    return row ? toCard(row) : null;
  }

  async extras(db: Db, id: string): Promise<ApplicationExtras | null> {
    const [row] = await db<
      Array<
        VerificationRow & {
          status: PhotographerStatus;
          declared_gear: string | null;
          interview_at: Date | null;
          interview_notes: string | null;
          decision_reason: string | null;
          decided_at: Date | null;
        }
      >
    >`
      SELECT p.status, a.declared_gear, a.interview_at, a.interview_notes, a.decision_reason,
             a.decided_at, ${db.unsafe(VERIFICATION_COLUMNS)}
      FROM photographer_applications a JOIN photographers p ON p.id = a.photographer_id
      WHERE a.id = ${id}`;
    if (!row) return null;
    return {
      photographerStatus: row.status,
      declaredGear: row.declared_gear,
      interviewAt: row.interview_at,
      interviewNotes: row.interview_notes,
      decisionReason: row.decision_reason,
      decidedAt: row.decided_at,
      verification: toVerification(row),
    };
  }

  async history(db: Db, id: string): Promise<ApplicationEventRecord[]> {
    const rows = await db<
      {
        from_stage: ApplicationStage | null;
        to_stage: ApplicationStage;
        actor_staff_id: string | null;
        note: string | null;
        created_at: Date;
      }[]
    >`
      SELECT from_stage, to_stage, actor_staff_id, note, created_at
      FROM photographer_application_events WHERE application_id = ${id}
      ORDER BY created_at, (from_stage IS NOT NULL), id`;
    return rows.map((r) => ({
      fromStage: r.from_stage,
      toStage: r.to_stage,
      actorStaffId: r.actor_staff_id,
      note: r.note,
      at: r.created_at,
    }));
  }

  /** Locks the application and its photographer for a move. */
  async lock(tx: Tx, id: string): Promise<ApplicationLock | null> {
    const [row] = await tx<
      Array<
        VerificationRow & {
          id: string;
          photographer_id: string;
          city_id: string;
          stage: ApplicationStage;
          status: PhotographerStatus;
        }
      >
    >`
      SELECT a.id, a.photographer_id, p.city_id, a.stage, p.status,
             ${tx.unsafe(VERIFICATION_COLUMNS)}
      FROM photographer_applications a JOIN photographers p ON p.id = a.photographer_id
      WHERE a.id = ${id}
      FOR UPDATE OF a, p`;
    if (!row) return null;
    return {
      id: row.id,
      photographerId: row.photographer_id,
      cityId: row.city_id,
      stage: row.stage,
      photographerStatus: row.status,
      verification: toVerification(row),
    };
  }

  async setStage(tx: Tx, id: string, stage: ApplicationStage): Promise<void> {
    await tx`UPDATE photographer_applications SET stage = ${stage} WHERE id = ${id}`;
  }

  async setDecision(
    tx: Tx,
    id: string,
    d: {
      readonly stage: 'APPROVED' | 'REJECTED';
      readonly reason: string;
      readonly staffId: string;
      readonly at: Date;
    },
  ): Promise<void> {
    await tx`
      UPDATE photographer_applications
      SET stage = ${d.stage}, decision = ${d.stage}, decision_reason = ${d.reason},
          decided_by = ${d.staffId}, decided_at = ${d.at}
      WHERE id = ${id}`;
  }

  /** APPLICANT → ACTIVE at approval (the schema CHECK refuses it without the four checks). */
  async activateApplicant(tx: Tx, photographerId: string, at: Date): Promise<boolean> {
    const rows = await tx`
      UPDATE photographers SET status = 'ACTIVE', onboarded_at = coalesce(onboarded_at, ${at})
      WHERE id = ${photographerId} AND status = 'APPLICANT'
      RETURNING id`;
    return rows.length > 0;
  }

  async appendEvent(
    tx: Tx,
    e: {
      readonly applicationId: string;
      readonly from: ApplicationStage | null;
      readonly to: ApplicationStage;
      readonly staffId: string;
      readonly note: string | null;
      readonly at: Date;
    },
  ): Promise<void> {
    await tx`
      INSERT INTO photographer_application_events
        (application_id, from_stage, to_stage, actor_staff_id, note, created_at)
      VALUES (${e.applicationId}, ${e.from}, ${e.to}, ${e.staffId}, ${e.note}, ${e.at})`;
  }

  /** A new APPLICANT photographer and their APPLIED application; returns the application id. */
  async createApplicant(tx: Tx, a: NewApplicant, at: Date): Promise<string> {
    const [pro] = await tx<{ id: string }[]>`
      INSERT INTO photographers (phone_e164, full_name, city_id, status, created_at, updated_at)
      VALUES (${a.phone}, ${a.fullName}, ${a.cityId}, 'APPLICANT', ${at}, ${at})
      RETURNING id`;
    if (!pro) throw new Error('createApplicant: no photographer row');
    const [app] = await tx<{ id: string }[]>`
      INSERT INTO photographer_applications (photographer_id, stage, source, portfolio_url,
        years_experience, requested_max_tier, created_at, updated_at)
      VALUES (${pro.id}, 'APPLIED', ${a.source}, ${a.portfolioUrl}, ${a.yearsExperience},
              ${a.requestedMaxTier}, ${at}, ${at})
      RETURNING id`;
    if (!app) throw new Error('createApplicant: no application row');
    return app.id;
  }

  /** In-flight applications (not on hold) in the caller's cities — the Today count. */
  async countWaiting(
    db: Db,
    scope: CityScope,
    stages: readonly ApplicationStage[],
  ): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM photographer_applications a JOIN photographers p ON p.id = a.photographer_id
      WHERE ${cityClause(db, scope)} AND a.stage IN ${db([...stages])}`;
    return row?.n ?? 0;
  }
}
