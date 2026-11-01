import { randomUUID } from 'node:crypto';
import type { MaskedCallResponse } from '@clickco/contracts';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { ENV, type Env } from '../../config/env';
import { SQL } from '../../infra/db/db.module';
import type { PublishedEvent } from '../../infra/outbox/outbox-subscribers';
import { BookingsService } from '../bookings/bookings.service';
import { AssignmentReads } from '../dispatch/assignment-reads.service';
import { PhotographersService } from '../photographers/photographers.service';
import { UsersService } from '../users/users.service';
import { CALLS_CONFIG } from './calls.config';
import { CALLS_PORT, CallConnectError, type CallStatusUpdate, type CallsPort } from './calls.port';
import {
  type CallBinding,
  CallBindingsRepository,
  isOpen,
} from './repositories/call-bindings.repository';
import {
  type CallerKind,
  type CallLogEntry,
  CallLogsRepository,
} from './repositories/call-logs.repository';

const str = (payload: Readonly<Record<string, unknown>>, key: string): string | null => {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
};

/** Assignment statuses that no longer hold the booking (re-dispatched or no-show). */
const ENDED = new Set(['RELEASED', 'ABANDONED']);

const tooMany = () =>
  new HttpException(
    { code: 'TOO_MANY_CALLS', message: 'Too many calls just now — try again later' },
    HttpStatus.TOO_MANY_REQUESTS,
  );

const notAvailable = () =>
  new ConflictException({
    code: 'CALL_NOT_AVAILABLE',
    message: 'Calling opens once a photographer is assigned and closes 2 hours after the shoot',
  });

export type StatusOutcome = 'RECORDED' | 'DUPLICATE' | 'UNKNOWN_CALL';

/**
 * Masked calls (ADR-0027 D3). Owns call_bindings (a booking's call window: open at assignment,
 * closed 2 h after check-out, at once on re-dispatch or cancellation) and call_logs (who asked,
 * the provider's id, status and duration — never a number, never a recording). Real numbers are
 * read here only to hand to the provider; responses carry the virtual number alone.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(CALLS_PORT) private readonly port: CallsPort,
    @Inject(CallBindingsRepository) private readonly bindings: CallBindingsRepository,
    @Inject(CallLogsRepository) private readonly logs: CallLogsRepository,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
  ) {}

  /** The number both sides see (it goes into the "photographer assigned" message). */
  get virtualNumber(): string {
    return this.port.virtualNumber;
  }

  // ── Binding lifecycle (outbox subscribers; every handler is idempotent) ──────────────────

  /**
   * booking.assigned: the window opens for this assignment — only while it is still the booking's
   * current one. A retried assigned event delivered after the re-dispatch that released it would
   * otherwise open a window nothing ever closes.
   */
  async open(event: PublishedEvent): Promise<void> {
    const assignmentId = str(event.payload, 'assignment_id');
    const photographerId = str(event.payload, 'photographer_id');
    if (!assignmentId || !photographerId) return;
    if (!(await this.isCurrent(event.aggregateId, assignmentId))) return;
    const booking = await this.bookings.contactFacts(event.aggregateId);
    if (!booking) return;
    await this.bindings.open(this.sql, {
      bookingId: booking.bookingId,
      assignmentId,
      photographerId,
      userId: booking.userId,
      virtualNumber: this.port.virtualNumber,
      openedAt: event.occurredAt,
    });
  }

  /** booking.checked_out: open until check-out + 2 h. */
  async checkedOut(event: PublishedEvent): Promise<void> {
    const assignmentId = str(event.payload, 'assignment_id');
    if (!assignmentId) return;
    const checkOut = str(event.payload, 'sla_t0');
    const at = checkOut ? new Date(checkOut) : event.occurredAt;
    await this.bindings.scheduleClose(
      this.sql,
      assignmentId,
      new Date(at.getTime() + CALLS_CONFIG.openAfterShootMs),
    );
  }

  /** booking.access_denied / booking.unsafe_site: the shoot ended without a check-out. */
  async shootEnded(event: PublishedEvent): Promise<void> {
    await this.bindings.scheduleCloseForBooking(
      this.sql,
      event.aggregateId,
      new Date(event.occurredAt.getTime() + CALLS_CONFIG.openAfterShootMs),
    );
  }

  /** booking.redispatching: the released photographer's binding closes at once. */
  async released(event: PublishedEvent): Promise<void> {
    const assignmentId = str(event.payload, 'assignment_id');
    if (assignmentId) await this.bindings.closeAssignment(this.sql, assignmentId, event.occurredAt);
  }

  /** A cancellation: every binding of the booking closes at once. */
  async cancelled(event: PublishedEvent): Promise<void> {
    await this.bindings.closeBooking(this.sql, event.aggregateId, event.occurredAt);
  }

  // ── Requests ──────────────────────────────────────────────────────────────────────────────

  /** POST /bookings/:id/call — the client calls the assigned photographer. */
  async callFromClient(userId: string, bookingId: string): Promise<MaskedCallResponse> {
    const binding = await this.bindings.latestForUser(this.sql, bookingId, userId);
    if (!binding) {
      if (!(await this.bookings.findForUser(userId, bookingId))) {
        throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });
      }
      throw notAvailable();
    }
    return this.place(binding, 'USER');
  }

  /** POST /pro/assignments/:id/call — the assigned photographer calls the client. */
  async callFromPhotographer(
    photographerId: string,
    assignmentId: string,
  ): Promise<MaskedCallResponse> {
    const binding = await this.bindings.forPhotographer(this.sql, assignmentId, photographerId);
    if (!binding) {
      throw new NotFoundException({
        code: 'ASSIGNMENT_NOT_FOUND',
        message: 'Assignment not found',
      });
    }
    return this.place(binding, 'PHOTOGRAPHER');
  }

  /** The provider's final status for a call (Exotel's status callback). Idempotent. */
  async recordStatus(update: CallStatusUpdate): Promise<StatusOutcome> {
    return this.sql.begin(async (tx) => {
      await this.logs.lockProviderCall(tx, this.port.provider, update.providerCallId);
      const placed = await this.logs.findPlaced(tx, this.port.provider, update.providerCallId);
      if (!placed) return 'UNKNOWN_CALL';
      if (placed.settled) return 'DUPLICATE';
      await this.logs.insert(tx, {
        callId: placed.callId,
        bindingId: placed.bindingId,
        bookingId: placed.bookingId,
        callerKind: placed.callerKind,
        provider: this.port.provider,
        providerCallId: update.providerCallId,
        status: update.status,
        durationSeconds: update.durationSeconds,
        errorCode: null,
        at: this.clock(),
      });
      return 'RECORDED';
    });
  }

  /** The booking's latest assignment is this one and still holds it (dispatch owns assignments). */
  private async isCurrent(bookingId: string, assignmentId: string): Promise<boolean> {
    const latest = (await this.assignments.latestForBookings([bookingId])).get(bookingId);
    return latest?.assignmentId === assignmentId && !ENDED.has(latest.status);
  }

  private async place(binding: CallBinding, caller: CallerKind): Promise<MaskedCallResponse> {
    const now = this.clock();
    if (!isOpen(binding, now)) throw notAvailable();
    if (!(await this.isCurrent(binding.bookingId, binding.assignmentId))) {
      // Released without the binding closing (an out-of-order event): close it now.
      await this.bindings.closeAssignment(this.sql, binding.assignmentId, now);
      throw notAvailable();
    }
    const [userPhone, proPhone] = await Promise.all([
      this.users.findById(binding.userId).then((u) => u?.phone ?? null),
      this.photographers
        .contacts([binding.photographerId])
        .then((m) => m.get(binding.photographerId)?.phone ?? null),
    ]);
    if (!userPhone || !proPhone) throw notAvailable();
    const entry = {
      callId: randomUUID(),
      bindingId: binding.id,
      bookingId: binding.bookingId,
      callerKind: caller,
      provider: this.port.provider,
      durationSeconds: null,
    };
    await this.reserve(binding, caller, { ...entry, providerCallId: null, errorCode: null }, now);
    try {
      const receipt = await this.port.connect({
        from: caller === 'USER' ? userPhone : proPhone,
        to: caller === 'USER' ? proPhone : userPhone,
        callId: entry.callId,
        statusCallbackUrl: this.statusCallbackUrl(),
        timeLimitSeconds: CALLS_CONFIG.timeLimitSeconds,
      });
      await this.logs.insert(this.sql, {
        ...entry,
        providerCallId: receipt.providerCallId,
        status: 'INITIATED',
        errorCode: null,
        at: this.clock(),
      });
    } catch (error) {
      if (!(error instanceof CallConnectError)) throw error;
      this.logger.warn(`Masked call ${entry.callId} failed: ${error.code}`);
      await this.logs.insert(this.sql, {
        ...entry,
        providerCallId: null,
        status: 'FAILED',
        errorCode: error.code,
        at: this.clock(),
      });
      throw new ServiceUnavailableException({
        code: 'CALL_FAILED',
        message: 'We could not place the call — try again in a moment',
      });
    }
    return {
      bookingId: binding.bookingId,
      callId: entry.callId,
      virtualNumber: binding.virtualNumber,
      status: 'CONNECTING',
    };
  }

  /**
   * Counts this side's recent calls and reserves this one (a REQUESTED row) under one lock, before
   * the provider is asked: parallel requests queue here, so none slips past the limits.
   */
  private async reserve(
    binding: CallBinding,
    caller: CallerKind,
    entry: Omit<CallLogEntry, 'status' | 'at'>,
    now: Date,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.logs.lockCaller(tx, binding.id, caller);
      const placed = await this.logs.placedSince(
        tx,
        binding.id,
        caller,
        new Date(now.getTime() - CALLS_CONFIG.rateWindowMs),
        new Date(now.getTime() - CALLS_CONFIG.dayWindowMs),
      );
      if (
        placed.recent >= CALLS_CONFIG.maxCallsPerWindow ||
        placed.day >= CALLS_CONFIG.maxCallsPerDay
      ) {
        throw tooMany();
      }
      await this.logs.insert(tx, { ...entry, status: 'REQUESTED', at: now });
    });
  }

  private statusCallbackUrl(): string | null {
    const base = this.env.PUBLIC_API_URL?.replace(/\/+$/, '');
    const secret = this.env.EXOTEL_WEBHOOK_SECRET;
    return base && secret ? `${base}${CALLS_CONFIG.webhookPath}/${secret}` : null;
  }
}
