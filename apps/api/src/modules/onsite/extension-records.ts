import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../bookings/bookings.types';
import type { AssignmentEventRecord, Db, Tx } from './onsite.types';
import type { OnsiteContext } from './onsite-context';
import { emit } from './onsite-outbox';
import { AssignmentEventsRepository } from './repositories/assignment-events.repository';
import {
  type ExtensionDeclineReason,
  type ExtensionLedger,
  type ExtensionRequestState,
  extensionLedger,
} from './rules/extensions';

/** Extension state is derived from the append-only events (ADR-0013 D8). */
@Injectable()
export class ExtensionRecords {
  constructor(
    @Inject(AssignmentEventsRepository) private readonly events: AssignmentEventsRepository,
  ) {}

  async ledger(
    db: Db,
    assignmentId: string,
    now: Date,
  ): Promise<{
    readonly ledger: ExtensionLedger;
    readonly events: readonly AssignmentEventRecord[];
  }> {
    const events = await this.events.forAssignment(db, assignmentId);
    return { ledger: extensionLedger(events, now), events };
  }

  /** Records the resolution of the open request (caller holds the booking lock). */
  async decline(
    tx: Tx,
    ctx: OnsiteContext,
    request: ExtensionRequestState,
    reason: ExtensionDeclineReason,
    actor: Actor,
    at: Date,
  ): Promise<void> {
    await this.events.insert(tx, {
      assignmentId: ctx.assignment.id,
      bookingId: ctx.booking.bookingId,
      kind: 'EXTENSION_DECLINED',
      minutes: 60,
      amountPaise: request.amountPaise,
      note: reason,
      actorKind: actor.kind,
      actorId: actor.id,
      occurredAt: at,
    });
    await emit(tx, 'assignment.extension_declined', ctx.booking.bookingId, at, {
      assignment_id: ctx.assignment.id,
      event_id: request.eventId,
      reason,
      amount_paise: fromPaiseBigint(request.amountPaise),
    });
  }

  /** The shoot is ending: an unanswered request can no longer be approved. */
  async closeUnresolved(tx: Tx, ctx: OnsiteContext, actor: Actor, at: Date): Promise<void> {
    const { ledger } = await this.ledger(tx, ctx.assignment.id, at);
    if (!ledger.unresolved) return;
    const expired = at >= ledger.unresolved.expiresAt;
    await this.decline(tx, ctx, ledger.unresolved, expired ? 'EXPIRED' : 'SHOOT_ENDED', actor, at);
  }
}
