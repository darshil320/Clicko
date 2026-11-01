import type {
  ModerationDecision,
  ReporterKind,
  ReportReason,
  ReportStatus,
  ReportTargetKind,
} from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { Db, Reporter, ReportPageQuery, ReportRecord, ReportScope, Tx } from '../safety.types';

interface Row {
  id: string;
  reporter_kind: ReporterKind;
  reporter_id: string;
  target_kind: ReportTargetKind;
  target_id: string;
  booking_id: string | null;
  city_id: string;
  reason: ReportReason;
  note: string | null;
  reported_rating: number | null;
  reported_comment: string | null;
  status: ReportStatus;
  decision: ModerationDecision | null;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
}

const toRecord = (r: Row): ReportRecord => ({
  id: r.id,
  reporterKind: r.reporter_kind,
  reporterId: r.reporter_id,
  targetKind: r.target_kind,
  targetId: r.target_id,
  bookingId: r.booking_id,
  cityId: r.city_id,
  reason: r.reason,
  note: r.note,
  reportedRating: r.reported_rating,
  reportedComment: r.reported_comment,
  status: r.status,
  decision: r.decision,
  decisionNote: r.decision_note,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  createdAt: r.created_at,
});

/** `city_id IN (…)` for a city list, TRUE for every city. */
const inScope = (db: Db, scope: ReportScope) =>
  scope === 'ALL' ? db`TRUE` : scope.length === 0 ? db`FALSE` : db`r.city_id IN ${db([...scope])}`;

export interface NewReport {
  readonly reporter: Reporter;
  readonly targetKind: ReportTargetKind;
  readonly targetId: string;
  readonly bookingId: string | null;
  readonly cityId: string;
  readonly reason: ReportReason;
  readonly note: string | null;
  /** REVIEW only: what the review said when it was reported. */
  readonly reported: { readonly rating: number; readonly comment: string | null } | null;
  readonly at: Date;
}

export interface CloseOnTarget {
  readonly targetKind: ReportTargetKind;
  readonly targetId: string;
  readonly scope: ReportScope;
  readonly status: ReportStatus;
  readonly decision: ModerationDecision;
  readonly note: string;
  readonly staffId: string;
  readonly at: Date;
}

/** All SQL on `moderation_reports` (addendum 0016). */
@Injectable()
export class ReportsRepository {
  /** null when the reporter already has an OPEN report on this target (the partial unique index). */
  async insertOpen(tx: Tx, n: NewReport): Promise<ReportRecord | null> {
    const [row] = await tx<Row[]>`
      INSERT INTO moderation_reports (reporter_kind, reporter_id, target_kind, target_id,
                                      booking_id, city_id, reason, note, reported_rating,
                                      reported_comment, created_at)
      VALUES (${n.reporter.kind}, ${n.reporter.id}, ${n.targetKind}, ${n.targetId},
              ${n.bookingId}, ${n.cityId}, ${n.reason}, ${n.note},
              ${n.reported?.rating ?? null}, ${n.reported?.comment ?? null}, ${n.at})
      ON CONFLICT (reporter_kind, reporter_id, target_kind, target_id) WHERE status = 'OPEN'
      DO NOTHING
      RETURNING *`;
    return row ? toRecord(row) : null;
  }

  async countBySince(db: Db, reporter: Reporter, since: Date): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM moderation_reports
      WHERE reporter_kind = ${reporter.kind} AND reporter_id = ${reporter.id}
        AND created_at > ${since}`;
    return row?.n ?? 0;
  }

  async find(db: Db, id: string, scope: ReportScope): Promise<ReportRecord | null> {
    const [row] = await db<Row[]>`
      SELECT * FROM moderation_reports r WHERE r.id = ${id} AND ${inScope(db, scope)}`;
    return row ? toRecord(row) : null;
  }

  async lock(tx: Tx, id: string, scope: ReportScope): Promise<ReportRecord | null> {
    const [row] = await tx<Row[]>`
      SELECT * FROM moderation_reports r WHERE r.id = ${id} AND ${inScope(tx, scope)}
      FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  async cityOf(db: Db, id: string): Promise<string | null> {
    const [row] = await db<{ city_id: string }[]>`
      SELECT city_id FROM moderation_reports WHERE id = ${id}`;
    return row?.city_id ?? null;
  }

  /** OPEN oldest first; DECIDED / ALL by the latest event (decision, else filing) newest first. */
  async page(db: Db, q: ReportPageQuery): Promise<ReportRecord[]> {
    if (q.view === 'OPEN') {
      const after = q.after ? db`AND (r.created_at, r.id) > (${q.after.at}, ${q.after.id})` : db``;
      const rows = await db<Row[]>`
        SELECT * FROM moderation_reports r
        WHERE r.status = 'OPEN' AND ${inScope(db, q.scope)} ${after}
        ORDER BY r.created_at, r.id LIMIT ${q.limit}`;
      return rows.map(toRecord);
    }
    // DECIDED rows always have decided_at (a CHECK): sort on the column itself, which is indexed.
    const decided = q.view === 'DECIDED';
    const status = decided ? db`r.status <> 'OPEN'` : db`TRUE`;
    const key = decided ? db`r.decided_at` : db`coalesce(r.decided_at, r.created_at)`;
    const after = q.after ? db`AND (${key}, r.id) < (${q.after.at}, ${q.after.id})` : db``;
    const rows = await db<Row[]>`
      SELECT * FROM moderation_reports r
      WHERE ${status} AND ${inScope(db, q.scope)} ${after}
      ORDER BY ${key} DESC, r.id DESC LIMIT ${q.limit}`;
    return rows.map(toRecord);
  }

  /** Decides every OPEN report on the target in scope at once; returns their ids. */
  async closeOpenOnTarget(tx: Tx, c: CloseOnTarget): Promise<string[]> {
    const rows = await tx<{ id: string }[]>`
      UPDATE moderation_reports r
      SET status = ${c.status}, decision = ${c.decision}, decision_note = ${c.note},
          decided_by = ${c.staffId}, decided_at = ${c.at}
      WHERE r.target_kind = ${c.targetKind} AND r.target_id = ${c.targetId}
        AND r.status = 'OPEN' AND ${inScope(tx, c.scope)}
      RETURNING r.id`;
    return rows.map((r) => r.id);
  }

  async countOpen(db: Db, scope: ReportScope): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM moderation_reports r
      WHERE r.status = 'OPEN' AND ${inScope(db, scope)}`;
    return row?.n ?? 0;
  }

  async countOpenOnTarget(
    db: Db,
    targetKind: ReportTargetKind,
    targetId: string,
    scope: ReportScope,
  ): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM moderation_reports r
      WHERE r.target_kind = ${targetKind} AND r.target_id = ${targetId} AND r.status = 'OPEN'
        AND ${inScope(db, scope)}`;
    return row?.n ?? 0;
  }
}
