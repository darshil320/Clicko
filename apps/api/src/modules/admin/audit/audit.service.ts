import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../../common/clock';
import type { AuditState, TxHook } from '../../../common/tx-hook';
import { SQL } from '../../../infra/db/db.module';
import type { AuditActor, AuditContext } from '../access/staff-context';
import { type AuditRecord, AuditRepository } from './audit.repository';

export interface AuditEntry {
  /** Defaults to the handler's @Audited action. */
  readonly action?: string;
  /** Defaults to the signed-in staff member (or SYSTEM for the CLI). */
  readonly actor?: AuditActor;
  readonly entityKind: string;
  readonly entityId: string | null;
  readonly before?: AuditState | null;
  readonly after?: AuditState | null;
}

const SYSTEM: AuditActor = { kind: 'SYSTEM', id: null, email: null };

/**
 * The audit log writer (ADR-0025 D4, G-33). `record` takes the action's own transaction, so the
 * row and the change commit (or roll back) together. There is no update or delete.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditRepository) private readonly repo: AuditRepository,
  ) {}

  async record(
    tx: postgres.TransactionSql,
    ctx: AuditContext | null,
    entry: AuditEntry,
  ): Promise<void> {
    const action = entry.action ?? ctx?.action;
    if (!action) throw new Error('AuditService.record: no action');
    const actor = entry.actor ?? ctx?.actor ?? SYSTEM;
    await this.repo.insert(tx, {
      actorKind: actor.kind,
      actorId: actor.id,
      actorEmail: actor.email,
      action,
      entityKind: entry.entityKind,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      requestId: ctx?.requestId ?? null,
      occurredAt: this.clock(),
    });
  }

  /** A row on its own (sign-in events have no other change to ride with). */
  async recordAlone(ctx: AuditContext | null, entry: AuditEntry): Promise<void> {
    await this.sql.begin((tx) => this.record(tx, ctx, entry));
  }

  /** The TxHook a domain service runs inside its transaction for this entity. */
  hook(ctx: AuditContext, entityKind: string, entityId: string): TxHook {
    return (tx, change) =>
      this.record(tx, ctx, { entityKind, entityId, before: change.before, after: change.after });
  }

  forEntities(
    entities: ReadonlyArray<{ readonly kind: string; readonly ids: readonly string[] }>,
    limit = 200,
  ): Promise<AuditRecord[]> {
    return this.repo.forEntities(this.sql, entities, limit);
  }
}
