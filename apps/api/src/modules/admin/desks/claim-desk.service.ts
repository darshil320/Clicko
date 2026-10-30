import type {
  AdminApproveClaimBody,
  AdminAssessClaimBody,
  AdminClaimItem,
  AdminClaimPage,
  AdminClaimQuery,
  AdminCreateClaimBody,
  AdminRejectClaimBody,
} from '@clickco/contracts';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../../common/clock';
import type { ClaimRecord } from '../../care/care.types';
import { ClaimsService } from '../../care/claims.service';
import type { CityScope } from '../access/roles';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { CareContext } from './care-context';
import { evidenceStaff, toClaimItem } from './care-views';
import { decodeCursor, pageOf, TimeCursor } from './paging';

export type ClaimQuery = z.output<typeof AdminClaimQuery>;
export type CreateClaimBody = z.output<typeof AdminCreateClaimBody>;
export type AssessClaimBody = z.output<typeof AdminAssessClaimBody>;

const NOT_FOUND = { code: 'CLAIM_NOT_FOUND', message: 'Claim not found' };

/** The Equipment claims desk (SA-01, ADR-0026 D6). */
@Injectable()
export class ClaimDeskService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ClaimsService) private readonly claims: ClaimsService,
    @Inject(CareContext) private readonly context: CareContext,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(caller: StaffCaller, q: ClaimQuery): Promise<AdminClaimPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const rows = await this.claims.page({
      filter: q.status,
      bookings: this.context.bookingScope(caller.scope),
      ...(cursor ? { after: { at: new Date(cursor.t), id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (c) => ({
      t: (q.status === 'DECIDED' && c.resolvedAt ? c.resolvedAt : c.reportedAt).toISOString(),
      i: c.id,
    }));
    return { items: await this.items(page.items), nextCursor: page.nextCursor };
  }

  /** The photographer on the booking files it (logged by staff until the Pro app does). */
  async create(
    caller: StaffCaller,
    ctx: AuditContext,
    body: CreateClaimBody,
  ): Promise<AdminClaimItem> {
    const bookingId = await this.context.bookingIdFor(body.bookingReference, caller.scope);
    const booking = await this.context.bookingsContext([bookingId]);
    const photographer = booking.photographerOf.get(bookingId);
    if (!photographer) {
      throw new UnprocessableEntityException({
        code: 'NO_PHOTOGRAPHER',
        message: 'This booking never had a photographer, so there is no equipment to claim for',
      });
    }
    const claim = await this.claims.create({
      bookingId,
      photographerId: photographer.id,
      incidentAt: new Date(body.incidentAt),
      cause: body.cause,
      description: body.description,
      claimedAmountPaise: body.claimedAmountPaise,
      links: body.links,
      staffId: caller.id,
      now: this.clock(),
      auditFor: (id) => this.audit.hook(ctx, 'equipment_claim', id),
    });
    return this.item(claim);
  }

  async assess(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
    body: AssessClaimBody,
  ): Promise<AdminClaimItem> {
    const claim = await this.claims.assess({
      id,
      ...(body.note ? { note: body.note } : {}),
      links: body.links,
      staffId: caller.id,
      bookings: this.context.bookingScope(caller.scope),
      now: this.clock(),
      audit: this.audit.hook(ctx, 'equipment_claim', id),
    });
    return this.item(claim);
  }

  async approve(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
    body: AdminApproveClaimBody,
  ): Promise<AdminClaimItem> {
    await this.assertNotLoggedBy(caller, id);
    const claim = await this.claims.approve({
      id,
      amountPaise: body.amountPaise,
      note: body.note,
      staffId: caller.id,
      bookings: this.context.bookingScope(caller.scope),
      now: this.clock(),
      audit: this.audit.hook(ctx, 'equipment_claim', id),
    });
    return this.item(claim);
  }

  async reject(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
    body: AdminRejectClaimBody,
  ): Promise<AdminClaimItem> {
    const claim = await this.claims.reject({
      id,
      reason: body.reason,
      staffId: caller.id,
      bookings: this.context.bookingScope(caller.scope),
      now: this.clock(),
      audit: this.audit.hook(ctx, 'equipment_claim', id),
    });
    return this.item(claim);
  }

  /**
   * Four eyes (standard for anything that leads to a payment): whoever logged the claim does not
   * approve it. Who logged it is the `claim.create` audit row.
   */
  private async assertNotLoggedBy(caller: StaffCaller, claimId: string): Promise<void> {
    const rows = await this.audit.forEntities([{ kind: 'equipment_claim', ids: [claimId] }]);
    const loggedBy = rows.find((r) => r.action === 'claim.create')?.actorId ?? null;
    if (loggedBy === caller.id) {
      throw new ForbiddenException({
        code: 'SAME_PERSON',
        message: 'You logged this claim, so someone else needs to approve it',
      });
    }
  }

  /** Today: claims waiting for a decision in `scope`. */
  overviewPending(scope: CityScope): Promise<number> {
    return this.claims.countPending(this.context.bookingScope(scope));
  }

  private async item(claim: ClaimRecord): Promise<AdminClaimItem> {
    const [item] = await this.items([claim]);
    if (!item) throw new NotFoundException(NOT_FOUND);
    return item;
  }

  private async items(rows: readonly ClaimRecord[]): Promise<AdminClaimItem[]> {
    const [ctx, photographers, staff] = await Promise.all([
      this.context.bookingsContext(rows.map((r) => r.bookingId)),
      this.context.photographerNames(rows.map((r) => r.photographerId)),
      this.context.staff.of(rows.flatMap(evidenceStaff)),
    ]);
    return rows.flatMap((r) => {
      const item = toClaimItem(r, ctx, photographers, staff);
      return item ? [item] : [];
    });
  }
}
