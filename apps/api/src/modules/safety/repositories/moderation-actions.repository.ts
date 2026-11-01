import type { ModerationDecision, ReporterKind, ReportTargetKind } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { Db, ModerationActionRecord, ReportScope, Tx } from '../safety.types';

interface Row {
  report_id: string;
  decision: ModerationDecision;
  target_kind: ReportTargetKind;
  target_id: string;
  warned_kind: ReporterKind | null;
  warned_id: string | null;
  staff_id: string;
  city_id: string;
  note: string;
  reports_closed: number;
  created_at: Date;
}

/** `city_id IN (…)` for a city list, TRUE for every city. */
const inScope = (db: Db, scope: ReportScope) =>
  scope === 'ALL' ? db`TRUE` : scope.length === 0 ? db`FALSE` : db`city_id IN ${db([...scope])}`;

const toRecord = (r: Row): ModerationActionRecord => ({
  reportId: r.report_id,
  decision: r.decision,
  targetKind: r.target_kind,
  targetId: r.target_id,
  warnedKind: r.warned_kind,
  warnedId: r.warned_id,
  staffId: r.staff_id,
  cityId: r.city_id,
  note: r.note,
  reportsClosed: r.reports_closed,
  createdAt: r.created_at,
});

/** All SQL on `moderation_actions` — append-only (addendum 0016): INSERT and SELECT only. */
@Injectable()
export class ModerationActionsRepository {
  async insert(tx: Tx, a: ModerationActionRecord): Promise<void> {
    await tx`
      INSERT INTO moderation_actions (report_id, decision, target_kind, target_id, warned_kind,
                                      warned_id, staff_id, city_id, note, reports_closed,
                                      created_at)
      VALUES (${a.reportId}, ${a.decision}, ${a.targetKind}, ${a.targetId}, ${a.warnedKind},
              ${a.warnedId}, ${a.staffId}, ${a.cityId}, ${a.note}, ${a.reportsClosed},
              ${a.createdAt})`;
  }

  /** Past decisions on a target in the caller's cities, newest first. */
  async forTarget(
    db: Db,
    targetKind: ReportTargetKind,
    targetId: string,
    scope: ReportScope,
    limit = 50,
  ): Promise<ModerationActionRecord[]> {
    const rows = await db<Row[]>`
      SELECT * FROM moderation_actions
      WHERE target_kind = ${targetKind} AND target_id = ${targetId} AND ${inScope(db, scope)}
      ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
    return rows.map(toRecord);
  }

  /** Warnings a person was given in the caller's cities. */
  async warningsFor(db: Db, kind: ReporterKind, id: string, scope: ReportScope): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM moderation_actions
      WHERE decision = 'WARN' AND warned_kind = ${kind} AND warned_id = ${id}
        AND ${inScope(db, scope)}`;
    return row?.n ?? 0;
  }
}
