import {
  ACK_DUE_SOON_MS,
  RESOLVE_DUE_SOON_MS,
  type TicketCategory,
  type TicketRaisedBy,
  ticketDeadlines,
  ticketStatusAfter,
} from '@clickco/contracts';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type postgres from 'postgres';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import type { TicketMessageRecord, TicketPageQuery, TicketRecord, TicketScope } from './care.types';
import {
  CLIENT_CARE_CONFIG,
  clientTicketSubject,
  isGrievanceCategory,
  ticketMessageEffect,
} from './care-rules';
import { SupportTicketsRepository } from './repositories/support-tickets.repository';

const NOT_FOUND = { code: 'TICKET_NOT_FOUND', message: 'Ticket not found' };
const DONE = { code: 'TICKET_RESOLVED', message: 'This ticket is already resolved' };
const BOOKING_NOT_FOUND = { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' };
const DAY_MS = 86_400_000;

/** A client raising a ticket from the app (ADR-0027 D5). Contact details come from the account. */
export interface ClientTicketInput {
  readonly userId: string;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly bookingId: string | null;
  readonly category: TicketCategory;
  readonly message: string;
}

export interface NewTicketInput {
  readonly raisedBy: TicketRaisedBy;
  readonly photographerId: string | null;
  readonly contactName: string;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly bookingId: string | null;
  readonly category: TicketCategory;
  readonly subject: string;
  readonly message: string;
}

/**
 * Grievance tickets (SA-02, Consumer Protection (E-Commerce) Rules 2020): every ticket carries
 * its two statutory clocks from receipt — acknowledge in 48 h, resolve in 30 days. Messages are
 * append-only; a reply to the customer counts as the acknowledgement. Each change commits with
 * its audit row.
 */
@Injectable()
export class TicketsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(SupportTicketsRepository) private readonly repo: SupportTicketsRepository,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  /**
   * The client raises a ticket (SA-02): about one of their own bookings (someone else's is 404,
   * like a missing one) or about nothing in particular. Both statutory clocks start now. At most
   * CLIENT_CARE_CONFIG.ticketsPerUserPerDay a day, counted under a per-client lock in the insert's
   * transaction, so two at once cannot both slip under it on any instance. The ticket, its first
   * message (the client's words) and `ticket.raised` commit together.
   */
  async raiseForClient(c: ClientTicketInput, now: Date): Promise<TicketRecord> {
    const booking = c.bookingId ? await this.bookings.findForUser(c.userId, c.bookingId) : null;
    if (c.bookingId && !booking) throw new NotFoundException(BOOKING_NOT_FOUND);
    const deadlines = ticketDeadlines(now);
    const isGrievance = isGrievanceCategory(c.category);
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`care:tickets:user:${c.userId}`}))`;
      const today = await this.repo.countForUserSince(
        tx,
        c.userId,
        new Date(now.getTime() - DAY_MS),
      );
      if (today >= CLIENT_CARE_CONFIG.ticketsPerUserPerDay) {
        throw new HttpException(
          {
            code: 'RATE_LIMITED',
            message:
              'You have raised several tickets today. We will get back to you on those first.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const id = await this.repo.insert(tx, {
        raisedByKind: 'USER',
        userId: c.userId,
        photographerId: null,
        contactName: c.contactName,
        contactPhone: c.contactPhone,
        contactEmail: null,
        bookingId: booking?.id ?? null,
        category: c.category,
        isGrievance,
        subject: clientTicketSubject(c.category, booking?.reference ?? null),
        receivedAt: now,
        ackDueAt: deadlines.ackDueAt,
        resolveDueAt: deadlines.resolveDueAt,
      });
      await this.repo.insertMessage(tx, {
        ticketId: id,
        authorKind: 'CUSTOMER',
        authorId: null,
        body: c.message,
        isInternal: false,
        at: now,
      });
      const ticket = await this.repo.find(tx, id, null);
      if (!ticket) throw new Error(`ticket ${id} vanished in its own transaction`);
      // No message text or contact details in the event: notifications map ids to templates.
      await appendDomainEvent(tx, {
        eventType: 'ticket.raised',
        aggregateKind: 'support_ticket',
        aggregateId: id,
        occurredAt: now,
        payload: {
          ticket_id: id,
          reference: ticket.reference,
          raised_by_kind: 'USER',
          user_id: c.userId,
          booking_id: ticket.bookingId,
          category: c.category,
          is_grievance: isGrievance,
          ack_due_at: deadlines.ackDueAt.toISOString(),
          resolve_due_at: deadlines.resolveDueAt.toISOString(),
        },
      });
      return ticket;
    });
  }

  /** The client's own tickets, newest first. */
  listForClient(userId: string): Promise<TicketRecord[]> {
    return this.repo.forUser(this.sql, userId, CLIENT_CARE_CONFIG.ticketListLimit);
  }

  page(q: TicketPageQuery): Promise<TicketRecord[]> {
    return this.repo.page(this.sql, q);
  }

  async detail(
    id: string,
    scope: TicketScope,
  ): Promise<{ ticket: TicketRecord; messages: TicketMessageRecord[] }> {
    const ticket = await this.repo.find(this.sql, id, scope);
    if (!ticket) throw new NotFoundException(NOT_FOUND);
    return { ticket, messages: await this.repo.messages(this.sql, id) };
  }

  /** Staff log a ticket for the customer; the first message is the customer's own words. */
  async create(c: {
    readonly input: NewTicketInput;
    readonly now: Date;
    readonly auditFor: (ticketId: string) => TxHook;
  }): Promise<string> {
    const deadlines = ticketDeadlines(c.now);
    const i = c.input;
    return this.sql.begin(async (tx) => {
      const id = await this.repo.insert(tx, {
        raisedByKind: i.raisedBy,
        photographerId: i.photographerId,
        contactName: i.contactName,
        contactPhone: i.contactPhone,
        contactEmail: i.contactEmail,
        bookingId: i.bookingId,
        category: i.category,
        isGrievance: isGrievanceCategory(i.category),
        subject: i.subject,
        receivedAt: c.now,
        ackDueAt: deadlines.ackDueAt,
        resolveDueAt: deadlines.resolveDueAt,
      });
      await this.repo.insertMessage(tx, {
        ticketId: id,
        authorKind: 'CUSTOMER',
        authorId: null,
        body: i.message,
        isInternal: false,
        at: c.now,
      });
      await c.auditFor(id)(tx, {
        before: null,
        after: {
          status: 'OPEN',
          category: i.category,
          booking_id: i.bookingId,
          ack_due_at: deadlines.ackDueAt.toISOString(),
          resolve_due_at: deadlines.resolveDueAt.toISOString(),
        },
      });
      return id;
    });
  }

  async addMessage(m: {
    readonly id: string;
    readonly kind: 'REPLY' | 'NOTE' | 'CUSTOMER';
    readonly body: string;
    readonly staffId: string;
    readonly scope: TicketScope;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const ticket = await this.repo.lock(tx, m.id, m.scope);
      if (!ticket) throw new NotFoundException(NOT_FOUND);
      const effect = ticketMessageEffect(ticket.status, m.kind, ticket.acknowledgedAt !== null);
      if (!effect) throw new ConflictException(DONE);
      await this.repo.insertMessage(tx, {
        ticketId: m.id,
        authorKind: effect.authorKind,
        authorId: effect.authorKind === 'STAFF' ? m.staffId : null,
        body: m.body,
        isInternal: effect.isInternal,
        at: m.now,
      });
      await this.repo.update(tx, m.id, {
        status: effect.status,
        ...(effect.acknowledges ? { acknowledgedAt: m.now } : {}),
      });
      await m.audit(tx, {
        before: { status: ticket.status },
        after: {
          status: effect.status,
          message_kind: m.kind,
          acknowledged: effect.acknowledges || ticket.acknowledgedAt !== null,
        },
      });
    });
  }

  async acknowledge(a: {
    readonly id: string;
    readonly scope: TicketScope;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const ticket = await this.repo.lock(tx, a.id, a.scope);
      if (!ticket) throw new NotFoundException(NOT_FOUND);
      const next = ticketStatusAfter(ticket.status, 'ACKNOWLEDGE');
      if (!next || ticket.acknowledgedAt) {
        throw new ConflictException({
          code: 'TICKET_ALREADY_ACKNOWLEDGED',
          message: 'This ticket is already acknowledged',
        });
      }
      await this.repo.update(tx, a.id, { status: next, acknowledgedAt: a.now });
      await a.audit(tx, {
        before: { status: ticket.status, acknowledged_at: null },
        after: { status: next, acknowledged_at: a.now.toISOString() },
      });
    });
  }

  async assign(a: {
    readonly id: string;
    readonly staffId: string;
    readonly scope: TicketScope;
    readonly audit: TxHook;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const ticket = await this.repo.lock(tx, a.id, a.scope);
      if (!ticket) throw new NotFoundException(NOT_FOUND);
      if (ticketStatusAfter(ticket.status, 'NOTE') === null) throw new ConflictException(DONE);
      await this.repo.update(tx, a.id, { assignedTo: a.staffId });
      await a.audit(tx, {
        before: { assigned_to: ticket.assignedTo },
        after: { assigned_to: a.staffId },
      });
    });
  }

  /** Resolving an unacknowledged ticket acknowledges it at the same moment (schema CHECK). */
  async resolve(r: {
    readonly id: string;
    readonly summary: string;
    readonly staffId: string;
    readonly scope: TicketScope;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const ticket = await this.repo.lock(tx, r.id, r.scope);
      if (!ticket) throw new NotFoundException(NOT_FOUND);
      const next = ticketStatusAfter(ticket.status, 'RESOLVE');
      if (!next) throw new ConflictException(DONE);
      await this.repo.update(tx, r.id, {
        status: next,
        acknowledgedAt: r.now,
        resolvedAt: r.now,
        resolutionSummary: r.summary,
      });
      await this.repo.insertMessage(tx, {
        ticketId: r.id,
        authorKind: 'SYSTEM',
        authorId: null,
        body: `Resolved: ${r.summary}`,
        isInternal: false,
        at: r.now,
      });
      await r.audit(tx, {
        before: { status: ticket.status },
        after: {
          status: next,
          summary: r.summary,
          resolved_on_time: r.now.getTime() <= ticket.resolveDueAt.getTime(),
        },
      });
    });
  }

  /** Today: open tickets whose running clock is amber, and those past due. */
  counts(scope: TicketScope, now: Date): Promise<{ dueSoon: number; overdue: number }> {
    return this.repo.countOpen(this.sql, scope, now, {
      ackMs: ACK_DUE_SOON_MS,
      resolveMs: RESOLVE_DUE_SOON_MS,
    });
  }
}
