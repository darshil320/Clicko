import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { AuditState } from '../../../common/tx-hook';

export interface AuditRow {
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly actorEmail: string | null;
  readonly action: string;
  readonly entityKind: string;
  readonly entityId: string | null;
  readonly before: AuditState | null;
  readonly after: AuditState | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly occurredAt: Date;
}

export interface AuditRecord extends AuditRow {
  readonly id: string;
}

interface Row {
  id: string;
  actor_kind: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_kind: string;
  entity_id: string | null;
  before_state: AuditState | null;
  after_state: AuditState | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  occurred_at: Date;
}

/** audit_logs (G-33) — append-only: a trigger forbids UPDATE and DELETE. INSERT and SELECT only. */
@Injectable()
export class AuditRepository {
  async insert(tx: postgres.TransactionSql, a: AuditRow): Promise<void> {
    const json = (v: AuditState | null) => (v === null ? null : tx.json(v as postgres.JSONValue));
    await tx`
      INSERT INTO audit_logs (actor_kind, actor_id, actor_email, action, entity_kind, entity_id,
                              before_state, after_state, ip_address, user_agent, request_id,
                              occurred_at)
      VALUES (${a.actorKind}, ${a.actorId}, ${a.actorEmail}, ${a.action}, ${a.entityKind},
              ${a.entityId}, ${json(a.before)}, ${json(a.after)}, ${a.ip}::inet, ${a.userAgent},
              ${a.requestId}, ${a.occurredAt})`;
  }

  /** Rows about any of these entities, newest first. */
  async forEntities(
    db: postgres.ISql,
    entities: ReadonlyArray<{ readonly kind: string; readonly ids: readonly string[] }>,
    limit: number,
  ): Promise<AuditRecord[]> {
    const wanted = entities.filter((e) => e.ids.length > 0);
    if (wanted.length === 0) return [];
    const where = wanted
      .map((e) => db`(entity_kind = ${e.kind} AND entity_id IN ${db([...e.ids])})`)
      .reduce((acc, part) => db`${acc} OR ${part}`);
    const rows = await db<Row[]>`
      SELECT id::text AS id, actor_kind, actor_id, actor_email, action, entity_kind, entity_id,
             before_state, after_state, host(ip_address) AS ip_address, user_agent, request_id,
             occurred_at
      FROM audit_logs WHERE ${where}
      ORDER BY occurred_at DESC, id DESC LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      actorKind: r.actor_kind,
      actorId: r.actor_id,
      actorEmail: r.actor_email,
      action: r.action,
      entityKind: r.entity_kind,
      entityId: r.entity_id,
      before: r.before_state,
      after: r.after_state,
      ip: r.ip_address,
      userAgent: r.user_agent,
      requestId: r.request_id,
      occurredAt: r.occurred_at,
    }));
  }
}
