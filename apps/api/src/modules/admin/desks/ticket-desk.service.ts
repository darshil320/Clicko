import type {
  AdminCreateTicketBody,
  AdminResolveTicketBody,
  AdminTicketDetail,
  AdminTicketMessageBody,
  AdminTicketPage,
  AdminTicketQuery,
} from '@clickco/contracts';
import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../../common/clock';
import type { TicketRecord } from '../../care/care.types';
import { TicketsService } from '../../care/tickets.service';
import type { CityScope } from '../access/roles';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { CareContext } from './care-context';
import { toTicketDetail, toTicketItem } from './care-views';
import { decodeCursor, pageOf, TimeCursor } from './paging';

export type TicketQuery = z.output<typeof AdminTicketQuery>;

/** The clock a ticket list is sorted on: the running deadline, or when it was resolved. */
const sortKey = (t: TicketRecord, resolved: boolean): Date =>
  resolved && t.resolvedAt ? t.resolvedAt : t.acknowledgedAt === null ? t.ackDueAt : t.resolveDueAt;

/**
 * The Support tickets desk (SA-02, ADR-0026 D6): the grievance board ordered by the nearest
 * statutory deadline, the append-only thread, reply / note / acknowledge / assign / resolve, and
 * tickets logged for a customer until the client app's entry point (S11).
 */
@Injectable()
export class TicketDeskService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(CareContext) private readonly context: CareContext,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(caller: StaffCaller, q: TicketQuery): Promise<AdminTicketPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const resolved = q.view === 'RESOLVED';
    const rows = await this.tickets.page({
      view: q.view,
      staffId: caller.id,
      now: this.clock(),
      scope: this.context.ticketScope(caller.scope),
      ...(cursor ? { after: { at: new Date(cursor.t), id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (t) => ({
      t: sortKey(t, resolved).toISOString(),
      i: t.id,
    }));
    const [references, staff] = await Promise.all([
      this.references(page.items),
      this.context.staff.of(page.items.map((t) => t.assignedTo)),
    ]);
    return {
      items: page.items.map((t) => toTicketItem(t, references, staff)),
      nextCursor: page.nextCursor,
    };
  }

  async detail(caller: StaffCaller, id: string): Promise<AdminTicketDetail> {
    const { ticket, messages } = await this.tickets.detail(
      id,
      this.context.ticketScope(caller.scope),
    );
    const [references, staff] = await Promise.all([
      this.references([ticket]),
      this.context.staff.of([ticket.assignedTo, ...messages.map((m) => m.authorId)]),
    ]);
    return toTicketDetail(ticket, messages, references, staff);
  }

  async create(
    caller: StaffCaller,
    ctx: AuditContext,
    body: AdminCreateTicketBody,
  ): Promise<AdminTicketDetail> {
    const bookingId = body.bookingReference
      ? await this.context.bookingIdFor(body.bookingReference, caller.scope)
      : null;
    const photographerId =
      body.raisedBy === 'PHOTOGRAPHER' && body.contactPhone
        ? await this.context.photographerInScope(body.contactPhone, caller.scope)
        : null;
    if (caller.scope !== 'ALL' && bookingId === null && photographerId === null) {
      throw new UnprocessableEntityException({
        code: 'TICKET_NEEDS_A_CITY',
        message: 'Add the booking reference so the ticket lands in your city',
      });
    }
    const id = await this.tickets.create({
      input: {
        raisedBy: body.raisedBy,
        photographerId,
        contactName: body.contactName,
        contactPhone: body.contactPhone ?? null,
        contactEmail: body.contactEmail ?? null,
        bookingId,
        category: body.category,
        subject: body.subject,
        message: body.message,
      },
      now: this.clock(),
      auditFor: (ticketId) => this.audit.hook(ctx, 'support_ticket', ticketId),
    });
    return this.detail(caller, id);
  }

  async message(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
    body: AdminTicketMessageBody,
  ): Promise<AdminTicketDetail> {
    await this.tickets.addMessage({
      id,
      kind: body.kind,
      body: body.body,
      staffId: caller.id,
      scope: this.context.ticketScope(caller.scope),
      now: this.clock(),
      audit: this.audit.hook(ctx, 'support_ticket', id),
    });
    return this.detail(caller, id);
  }

  async acknowledge(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
  ): Promise<AdminTicketDetail> {
    await this.tickets.acknowledge({
      id,
      scope: this.context.ticketScope(caller.scope),
      now: this.clock(),
      audit: this.audit.hook(ctx, 'support_ticket', id),
    });
    return this.detail(caller, id);
  }

  async assignToMe(caller: StaffCaller, ctx: AuditContext, id: string): Promise<AdminTicketDetail> {
    await this.tickets.assign({
      id,
      staffId: caller.id,
      scope: this.context.ticketScope(caller.scope),
      audit: this.audit.hook(ctx, 'support_ticket', id),
    });
    return this.detail(caller, id);
  }

  async resolve(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
    body: AdminResolveTicketBody,
  ): Promise<AdminTicketDetail> {
    await this.tickets.resolve({
      id,
      summary: body.summary,
      staffId: caller.id,
      scope: this.context.ticketScope(caller.scope),
      now: this.clock(),
      audit: this.audit.hook(ctx, 'support_ticket', id),
    });
    return this.detail(caller, id);
  }

  /** Today: open tickets whose running deadline is amber (`dueSoon`) or red (`overdue`). */
  overviewDue(scope: CityScope): Promise<{ dueSoon: number; overdue: number }> {
    return this.tickets.counts(this.context.ticketScope(scope), this.clock());
  }

  private async references(tickets: readonly TicketRecord[]): Promise<Map<string, string>> {
    const ids = tickets.flatMap((t) => (t.bookingId ? [t.bookingId] : []));
    if (ids.length === 0) return new Map();
    const ctx = await this.context.bookingsContext(ids);
    return new Map([...ctx.facts.values()].map((f) => [f.id, f.reference]));
  }
}
