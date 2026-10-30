import type { ClaimCause, EvidenceLinkInput } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEventOnce } from '../../infra/outbox/outbox';
import type { BookingScope, ClaimPageQuery, ClaimRecord } from './care.types';
import { claimApprovalProblem, evidenceEntries } from './care-rules';
import { EquipmentClaimsRepository } from './repositories/equipment-claims.repository';

const NOT_FOUND = { code: 'CLAIM_NOT_FOUND', message: 'Claim not found' };
const DECIDED = { code: 'CLAIM_DECIDED', message: 'This claim is already decided' };

const APPROVAL_MESSAGE = {
  ALREADY_DECIDED: DECIDED.message,
  ABOVE_CAP: 'The cap is ₹2,00,000 per incident',
  ABOVE_CLAIMED: 'You cannot approve more than was claimed',
  NO_EVIDENCE: 'Add at least one evidence link (a repair quote, an invoice or photos) first',
} as const;

/**
 * Equipment damage claims (SA-01, T&C §8.2; cap OD-08 ₹2,00,000). Staff log the photographer's
 * report, build an assessment trail (notes and evidence links) and approve up to the cap — which
 * raises an `EQUIPMENT_CLAIM_APPROVED` review item for finance to pay — or reject with a reason.
 */
@Injectable()
export class ClaimsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(EquipmentClaimsRepository) private readonly repo: EquipmentClaimsRepository,
  ) {}

  page(q: ClaimPageQuery): Promise<ClaimRecord[]> {
    return this.repo.page(this.sql, q);
  }

  async get(id: string, bookings: BookingScope): Promise<ClaimRecord> {
    const claim = await this.repo.find(this.sql, id, bookings);
    if (!claim) throw new NotFoundException(NOT_FOUND);
    return claim;
  }

  async create(c: {
    readonly bookingId: string;
    readonly photographerId: string;
    readonly incidentAt: Date;
    readonly cause: ClaimCause;
    readonly description: string;
    readonly claimedAmountPaise: number;
    readonly links: readonly EvidenceLinkInput[];
    readonly staffId: string;
    readonly now: Date;
    readonly auditFor: (claimId: string) => TxHook;
  }): Promise<ClaimRecord> {
    if (c.incidentAt.getTime() > c.now.getTime()) {
      throw new UnprocessableEntityException({
        code: 'INCIDENT_IN_FUTURE',
        message: 'The incident time cannot be in the future',
      });
    }
    const id = await this.sql.begin(async (tx) => {
      const claimId = await this.repo.insert(tx, {
        bookingId: c.bookingId,
        photographerId: c.photographerId,
        reportedAt: c.now,
        incidentAt: c.incidentAt,
        cause: c.cause,
        description: c.description,
        evidence: evidenceEntries({ links: c.links }, c.staffId, c.now),
        claimedAmountPaise: BigInt(c.claimedAmountPaise),
      });
      await c.auditFor(claimId)(tx, {
        before: null,
        after: {
          status: 'OPEN',
          booking_id: c.bookingId,
          photographer_id: c.photographerId,
          cause: c.cause,
          claimed_amount_paise: c.claimedAmountPaise,
        },
      });
      return claimId;
    });
    return this.get(id, null);
  }

  async assess(a: {
    readonly id: string;
    readonly note?: string;
    readonly links: readonly EvidenceLinkInput[];
    readonly staffId: string;
    readonly bookings: BookingScope;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<ClaimRecord> {
    await this.sql.begin(async (tx) => {
      const claim = await this.repo.lock(tx, a.id, a.bookings);
      if (!claim) throw new NotFoundException(NOT_FOUND);
      if (claim.status !== 'OPEN' && claim.status !== 'UNDER_REVIEW') {
        throw new ConflictException(DECIDED);
      }
      const entries = evidenceEntries(
        { ...(a.note ? { note: a.note } : {}), links: a.links },
        a.staffId,
        a.now,
      );
      await this.repo.appendEvidence(tx, a.id, entries);
      await a.audit(tx, {
        before: { status: claim.status, evidence_count: claim.evidence.length },
        after: {
          status: 'UNDER_REVIEW',
          evidence_count: claim.evidence.length + entries.length,
          note: a.note ?? null,
          links: a.links.map((l) => l.url),
        },
      });
    });
    return this.get(a.id, null);
  }

  async approve(a: {
    readonly id: string;
    readonly amountPaise: number;
    readonly note: string;
    readonly staffId: string;
    readonly bookings: BookingScope;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<ClaimRecord> {
    await this.sql.begin(async (tx) => {
      const claim = await this.repo.lock(tx, a.id, a.bookings);
      if (!claim) throw new NotFoundException(NOT_FOUND);
      const problem = claimApprovalProblem(claim, a.amountPaise);
      if (problem === 'ALREADY_DECIDED') throw new ConflictException(DECIDED);
      if (problem) {
        throw new UnprocessableEntityException({
          code: problem,
          message: APPROVAL_MESSAGE[problem],
        });
      }
      const amount = BigInt(a.amountPaise);
      await this.repo.approve(tx, a.id, {
        amountPaise: amount,
        staffId: a.staffId,
        note: a.note,
        at: a.now,
      });
      await appendDomainEventOnce(tx, {
        eventType: 'booking.needs_review',
        aggregateKind: 'booking',
        aggregateId: claim.bookingId,
        occurredAt: a.now,
        dedupeKey: `EQUIPMENT_CLAIM_APPROVED:${a.id}`,
        payload: {
          booking_id: claim.bookingId,
          reason: 'EQUIPMENT_CLAIM_APPROVED',
          claim_id: a.id,
          photographer_id: claim.photographerId,
          amount_paise: fromPaiseBigint(amount),
          claimed_amount_paise: fromPaiseBigint(claim.claimedAmountPaise),
          cause: claim.cause,
          note: a.note,
          approved_by_staff_id: a.staffId,
        },
      });
      await a.audit(tx, {
        before: { status: claim.status },
        after: { status: 'APPROVED', approved_amount_paise: a.amountPaise, note: a.note },
      });
    });
    return this.get(a.id, null);
  }

  async reject(r: {
    readonly id: string;
    readonly reason: string;
    readonly staffId: string;
    readonly bookings: BookingScope;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<ClaimRecord> {
    await this.sql.begin(async (tx) => {
      const claim = await this.repo.lock(tx, r.id, r.bookings);
      if (!claim) throw new NotFoundException(NOT_FOUND);
      if (claim.status !== 'OPEN' && claim.status !== 'UNDER_REVIEW') {
        throw new ConflictException(DECIDED);
      }
      await this.repo.reject(tx, r.id, { staffId: r.staffId, reason: r.reason, at: r.now });
      await r.audit(tx, {
        before: { status: claim.status },
        after: { status: 'REJECTED', reason: r.reason },
      });
    });
    return this.get(r.id, null);
  }

  /** Today: claims waiting for a decision. */
  countPending(bookings: BookingScope): Promise<number> {
    return this.repo.countPending(this.sql, bookings);
  }
}
