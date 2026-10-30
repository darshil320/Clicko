import type { QualityOutcome } from '@clickco/contracts';
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
import { BookingsService } from '../bookings/bookings.service';
import type { BookingScope, QualityPageQuery, QualityRecord } from './care.types';
import { qualityAmountProblem, qualityReviewReason } from './care-rules';
import { QualityEscalationsRepository } from './repositories/quality-escalations.repository';

const NOT_FOUND = { code: 'QUALITY_ISSUE_NOT_FOUND', message: 'Quality issue not found' };

const AMOUNT_MESSAGE = {
  CREDIT_ABOVE_TOTAL: 'A credit cannot be more than the booking total',
  REFUND_ABOVE_PAID: 'A refund cannot be more than the client has paid',
} as const;

/**
 * The Quality Manager's queue (G-07, ADR-0026 D6). Opening an issue moves the booking
 * DELIVERED → QUALITY_ESCALATION; the QM's decision closes the issue and the booking
 * (QUALITY_ESCALATION → CLOSED, ADR-0011) — status event, outbox event, the review item for a
 * credit / refund / reshoot and the audit row, all in one transaction. No money moves here: the
 * review item is settled on "To settle" (D2) under the refund and credit approvals.
 */
@Injectable()
export class QualityService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(QualityEscalationsRepository) private readonly repo: QualityEscalationsRepository,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  page(q: QualityPageQuery): Promise<QualityRecord[]> {
    return this.repo.page(this.sql, q);
  }

  async get(id: string, bookings: BookingScope): Promise<QualityRecord> {
    const record = await this.repo.find(this.sql, id, bookings);
    if (!record) throw new NotFoundException(NOT_FOUND);
    return record;
  }

  /** Staff log the client's complaint on a DELIVERED booking (DOMAIN §2, actor STAFF). */
  async open(o: {
    readonly bookingId: string;
    readonly complaint: string;
    readonly staffId: string;
    readonly now: Date;
    readonly auditFor: (escalationId: string) => TxHook;
  }): Promise<QualityRecord> {
    const id = await this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, o.bookingId);
      if (booking.status !== 'DELIVERED') {
        throw new ConflictException({
          code: 'BOOKING_NOT_DELIVERED',
          message:
            booking.status === 'QUALITY_ESCALATION'
              ? 'This booking already has an open quality issue'
              : 'Only a delivered booking (within 30 days of delivery) can get a quality issue',
        });
      }
      const escalationId = await this.repo.insert(tx, {
        bookingId: o.bookingId,
        staffId: o.staffId,
        complaint: o.complaint,
        at: o.now,
      });
      await this.bookings.transition(tx, {
        bookingId: o.bookingId,
        to: 'QUALITY_ESCALATION',
        actor: { kind: 'STAFF', id: o.staffId },
        occurredAt: o.now,
        reason: 'Quality issue raised for the client',
        payload: { escalation_id: escalationId },
      });
      await o.auditFor(escalationId)(tx, {
        before: { booking_status: 'DELIVERED' },
        after: {
          booking_status: 'QUALITY_ESCALATION',
          status: 'OPEN',
          booking_id: o.bookingId,
          complaint: o.complaint,
        },
      });
      return escalationId;
    });
    return this.get(id, null);
  }

  /** The QM picks it up: OPEN → IN_REVIEW, assigned to them. */
  async take(t: {
    readonly id: string;
    readonly staffId: string;
    readonly bookings: BookingScope;
    readonly audit: TxHook;
  }): Promise<QualityRecord> {
    await this.sql.begin(async (tx) => {
      const issue = await this.repo.lock(tx, t.id, t.bookings);
      if (!issue) throw new NotFoundException(NOT_FOUND);
      if (issue.status !== 'OPEN') {
        throw new ConflictException({
          code: 'QUALITY_ISSUE_NOT_OPEN',
          message:
            issue.status === 'IN_REVIEW'
              ? 'Someone is already reviewing this issue'
              : 'This issue is already decided',
        });
      }
      await this.repo.take(tx, t.id, t.staffId);
      await t.audit(tx, {
        before: { status: 'OPEN', assigned_qm_id: issue.assignedQmId },
        after: { status: 'IN_REVIEW', assigned_qm_id: t.staffId },
      });
    });
    return this.get(t.id, null);
  }

  async resolve(r: {
    readonly id: string;
    readonly outcome: QualityOutcome;
    readonly amountPaise: number;
    readonly note: string;
    readonly staffId: string;
    readonly bookings: BookingScope;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<QualityRecord> {
    await this.sql.begin(async (tx) => {
      const issue = await this.repo.lock(tx, r.id, r.bookings);
      if (!issue) throw new NotFoundException(NOT_FOUND);
      if (issue.status !== 'OPEN' && issue.status !== 'IN_REVIEW') {
        throw new ConflictException({
          code: 'QUALITY_ISSUE_DECIDED',
          message: 'This issue is already decided',
        });
      }
      const booking = await this.bookings.lock(tx, issue.bookingId);
      const problem = qualityAmountProblem(r.outcome, r.amountPaise, booking);
      if (problem) {
        throw new UnprocessableEntityException({ code: problem, message: AMOUNT_MESSAGE[problem] });
      }
      const remedy = BigInt(r.amountPaise);
      await this.repo.resolve(tx, r.id, {
        outcome: r.outcome,
        remedyPaise: remedy,
        note: r.note,
        staffId: r.staffId,
        at: r.now,
      });
      await this.bookings.recordClosed(tx, issue.bookingId, r.now);
      await this.bookings.transition(tx, {
        bookingId: issue.bookingId,
        to: 'CLOSED',
        actor: { kind: 'STAFF', id: r.staffId },
        occurredAt: r.now,
        reason: `Quality issue decided: ${r.outcome}`,
        payload: {
          escalation_id: r.id,
          outcome: r.outcome,
          amount_paise: fromPaiseBigint(remedy),
        },
      });
      const reason = qualityReviewReason(r.outcome);
      if (reason) {
        await appendDomainEventOnce(tx, {
          eventType: 'booking.needs_review',
          aggregateKind: 'booking',
          aggregateId: issue.bookingId,
          occurredAt: r.now,
          dedupeKey: `${reason}:${r.id}`,
          payload: {
            booking_id: issue.bookingId,
            reason,
            escalation_id: r.id,
            outcome: r.outcome,
            amount_paise: fromPaiseBigint(remedy),
            booking_total_paise: fromPaiseBigint(booking.totalPaise),
            amount_paid_paise: fromPaiseBigint(booking.amountPaidPaise),
            note: r.note,
            decided_by_staff_id: r.staffId,
          },
        });
      }
      await r.audit(tx, {
        before: { status: issue.status, booking_status: 'QUALITY_ESCALATION' },
        after: {
          status: 'RESOLVED',
          booking_status: 'CLOSED',
          outcome: r.outcome,
          amount_paise: fromPaiseBigint(remedy),
          note: r.note,
          review_reason: reason,
        },
      });
    });
    return this.get(r.id, null);
  }

  /** Today: issues waiting on the QM in these bookings' cities. */
  countOpen(bookings: BookingScope): Promise<number> {
    return this.repo.countOpen(this.sql, bookings);
  }
}
