import type {
  TicketAuthor,
  TicketCategory,
  TicketRaisedBy,
  TicketStatus,
} from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type {
  Db,
  NewTicket,
  TicketMessageRecord,
  TicketPageQuery,
  TicketRecord,
  TicketScope,
  Tx,
} from '../care.types';
import { and, ticketScopeClause } from './care-sql';

interface Row {
  id: string;
  reference: string;
  raised_by_kind: TicketRaisedBy;
  user_id: string | null;
  photographer_id: string | null;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  booking_id: string | null;
  category: TicketCategory;
  is_grievance: boolean;
  subject: string;
  status: TicketStatus;
  assigned_to: string | null;
  received_at: Date;
  ack_due_at: Date;
  acknowledged_at: Date | null;
  resolve_due_at: Date;
  resolved_at: Date | null;
  resolution_summary: string | null;
  last_message_at: Date | null;
  message_count: number;
}

const toRecord = (r: Row): TicketRecord => ({
  id: r.id,
  reference: r.reference,
  raisedByKind: r.raised_by_kind,
  userId: r.user_id,
  photographerId: r.photographer_id,
  contactName: r.contact_name,
  contactPhone: r.contact_phone,
  contactEmail: r.contact_email,
  bookingId: r.booking_id,
  category: r.category,
  isGrievance: r.is_grievance,
  subject: r.subject,
  status: r.status,
  assignedTo: r.assigned_to,
  receivedAt: r.received_at,
  ackDueAt: r.ack_due_at,
  acknowledgedAt: r.acknowledged_at,
  resolveDueAt: r.resolve_due_at,
  resolvedAt: r.resolved_at,
  resolutionSummary: r.resolution_summary,
  lastMessageAt: r.last_message_at,
  messageCount: r.message_count,
});

const COLUMNS = `t.id, t.reference, t.raised_by_kind, t.user_id, t.photographer_id, t.contact_name,
  t.contact_phone, t.contact_email, t.booking_id, t.category, t.is_grievance, t.subject, t.status,
  t.assigned_to, t.received_at, t.ack_due_at, t.acknowledged_at, t.resolve_due_at, t.resolved_at,
  t.resolution_summary,
  (SELECT max(m.created_at) FROM ticket_messages m WHERE m.ticket_id = t.id) AS last_message_at,
  (SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count`;

const DONE: readonly TicketStatus[] = ['RESOLVED', 'CLOSED'];

/** The statutory clock that is running: acknowledgement until acknowledged, then resolution. */
const NEXT_DUE = `CASE WHEN t.acknowledged_at IS NULL THEN t.ack_due_at ELSE t.resolve_due_at END`;

/**
 * support_tickets and ticket_messages (SA-02). Messages are append-only (a grievance trail is
 * evidence): there is no update or delete of a message here, and the table's trigger forbids it.
 */
@Injectable()
export class SupportTicketsRepository {
  async insert(tx: Tx, t: NewTicket): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO support_tickets (raised_by_kind, photographer_id, contact_name, contact_phone,
        contact_email, booking_id, category, is_grievance, subject, status, received_at,
        ack_due_at, resolve_due_at, created_at, updated_at)
      VALUES (${t.raisedByKind}, ${t.photographerId}, ${t.contactName}, ${t.contactPhone},
              ${t.contactEmail}, ${t.bookingId}, ${t.category}, ${t.isGrievance}, ${t.subject},
              'OPEN', ${t.receivedAt}, ${t.ackDueAt}, ${t.resolveDueAt}, ${t.receivedAt},
              ${t.receivedAt})
      RETURNING id`;
    if (!row) throw new Error('support_tickets insert returned nothing');
    return row.id;
  }

  async insertMessage(
    tx: Tx,
    m: {
      readonly ticketId: string;
      readonly authorKind: TicketAuthor;
      readonly authorId: string | null;
      readonly body: string;
      readonly isInternal: boolean;
      readonly at: Date;
    },
  ): Promise<void> {
    await tx`
      INSERT INTO ticket_messages (ticket_id, author_kind, author_id, body, is_internal, created_at)
      VALUES (${m.ticketId}, ${m.authorKind}, ${m.authorId}, ${m.body}, ${m.isInternal}, ${m.at})`;
  }

  async find(db: Db, id: string, scope: TicketScope): Promise<TicketRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM support_tickets t
      WHERE t.id = ${id} AND ${ticketScopeClause(db, scope)}`;
    return row ? toRecord(row) : null;
  }

  async lock(tx: Tx, id: string, scope: TicketScope): Promise<TicketRecord | null> {
    const [row] = await tx<Row[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM support_tickets t
      WHERE t.id = ${id} AND ${ticketScopeClause(tx, scope)}
      FOR UPDATE OF t`;
    return row ? toRecord(row) : null;
  }

  async messages(db: Db, ticketId: string): Promise<TicketMessageRecord[]> {
    const rows = await db<
      {
        id: string;
        ticket_id: string;
        author_kind: TicketAuthor;
        author_id: string | null;
        body: string;
        is_internal: boolean;
        created_at: Date;
      }[]
    >`
      SELECT id, ticket_id, author_kind, author_id, body, is_internal, created_at
      FROM ticket_messages WHERE ticket_id = ${ticketId}
      ORDER BY created_at, id`;
    return rows.map((r) => ({
      id: r.id,
      ticketId: r.ticket_id,
      authorKind: r.author_kind,
      authorId: r.author_id,
      body: r.body,
      isInternal: r.is_internal,
      createdAt: r.created_at,
    }));
  }

  /**
   * OPEN / MINE / OVERDUE: the nearest statutory deadline first. RESOLVED: the latest first.
   * OVERDUE = an acknowledgement or a resolution past its due time.
   */
  async page(db: Db, q: TicketPageQuery): Promise<TicketRecord[]> {
    const resolved = q.view === 'RESOLVED';
    const key = resolved ? db`t.resolved_at` : db`(${db.unsafe(NEXT_DUE)})`;
    const where = [
      ticketScopeClause(db, q.scope),
      resolved ? db`t.status IN ${db([...DONE])}` : db`t.status NOT IN ${db([...DONE])}`,
      ...(q.view === 'MINE' ? [db`t.assigned_to = ${q.staffId}`] : []),
      ...(q.view === 'OVERDUE' ? [this.overdue(db, q.now)] : []),
      ...(q.after
        ? [
            resolved
              ? db`(${key}, t.id) < (${q.after.at}, ${q.after.id}::uuid)`
              : db`(${key}, t.id) > (${q.after.at}, ${q.after.id}::uuid)`,
          ]
        : []),
    ];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM support_tickets t
      WHERE ${and(db, where)}
      ORDER BY ${resolved ? db`${key} DESC, t.id DESC` : db`${key} ASC, t.id ASC`}
      LIMIT ${q.limit}`;
    return rows.map(toRecord);
  }

  async update(
    tx: Tx,
    id: string,
    u: {
      readonly status?: TicketStatus;
      readonly acknowledgedAt?: Date;
      readonly assignedTo?: string;
      readonly resolvedAt?: Date;
      readonly resolutionSummary?: string;
    },
  ): Promise<void> {
    await tx`
      UPDATE support_tickets SET
        status = coalesce(${u.status ?? null}, status),
        acknowledged_at = coalesce(acknowledged_at, ${u.acknowledgedAt ?? null}),
        assigned_to = coalesce(${u.assignedTo ?? null}, assigned_to),
        resolved_at = coalesce(${u.resolvedAt ?? null}, resolved_at),
        resolution_summary = coalesce(${u.resolutionSummary ?? null}, resolution_summary)
      WHERE id = ${id}`;
  }

  /** Not done, and the running clock is past due (`overdue`) or within its amber window. */
  async countOpen(
    db: Db,
    scope: TicketScope,
    now: Date,
    soon: { readonly ackMs: number; readonly resolveMs: number },
  ): Promise<{ readonly dueSoon: number; readonly overdue: number }> {
    const [row] = await db<{ due_soon: number; overdue: number }[]>`
      SELECT
        count(*) FILTER (WHERE NOT (${this.overdue(db, now)}) AND (
          (t.acknowledged_at IS NULL
             AND t.ack_due_at <= ${new Date(now.getTime() + soon.ackMs)})
          OR (t.acknowledged_at IS NOT NULL
             AND t.resolve_due_at <= ${new Date(now.getTime() + soon.resolveMs)})))::int AS due_soon,
        count(*) FILTER (WHERE ${this.overdue(db, now)})::int AS overdue
      FROM support_tickets t
      WHERE t.status NOT IN ${db([...DONE])} AND ${ticketScopeClause(db, scope)}`;
    return { dueSoon: row?.due_soon ?? 0, overdue: row?.overdue ?? 0 };
  }

  private overdue(db: Db, now: Date) {
    return db`((t.acknowledged_at IS NULL AND t.ack_due_at < ${now}) OR t.resolve_due_at < ${now})`;
  }
}
