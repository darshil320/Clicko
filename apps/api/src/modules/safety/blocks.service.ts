import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import { AssignmentReads } from '../dispatch/assignment-reads.service';
import { PhotographersService } from '../photographers/photographers.service';
import { photographerNotFound } from './http-errors';
import { BlocksRepository } from './repositories/blocks.repository';
import type { BlockRecord, Tx } from './safety.types';

export interface BlockedView {
  readonly photographerId: string;
  readonly name: string;
  readonly blockedAt: Date;
}

/**
 * A client blocks a photographer who worked on one of their bookings (ADR-0027 D4). Blocking and
 * unblocking are idempotent; each real change emits a `client_block.*` outbox event in its
 * transaction. From then on dispatch (through ClientBlocksReader):
 * - never puts the photographer in a search for this client's bookings (new runs, next waves
 *   and re-dispatches alike);
 * - refuses their accept of an offer still open from before the block (checked under the
 *   booking lock), and on `client_block.added` withdraws such offers outright.
 * A shoot the photographer had already accepted stays assigned: blocking is not a cancellation.
 */
@Injectable()
export class BlocksService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(BlocksRepository) private readonly repo: BlocksRepository,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
  ) {}

  async list(userId: string): Promise<BlockedView[]> {
    const blocks = await this.repo.list(this.sql, userId);
    return this.withNames(blocks);
  }

  /** Idempotent: blocking twice answers the existing block and emits nothing. */
  async block(userId: string, photographerId: string, now: Date): Promise<BlockedView> {
    const block =
      (await this.repo.find(this.sql, userId, photographerId)) ??
      (await this.add(userId, photographerId, now));
    const [view] = await this.withNames([block]);
    if (!view) throw new Error('block: no view');
    return view;
  }

  /** Only a photographer who held an assignment on one of the client's bookings. */
  private async add(userId: string, photographerId: string, now: Date): Promise<BlockRecord> {
    const bookingIds = (await this.bookings.listForUser(userId)).map((b) => b.id);
    if (!(await this.assignments.everAssigned(photographerId, bookingIds))) {
      throw photographerNotFound();
    }
    return this.sql.begin(async (tx) => {
      const created = await this.repo.insert(tx, userId, photographerId, now);
      if (created) {
        await this.emit(tx, 'client_block.added', created, now);
        return created;
      }
      // A concurrent request blocked them first: same outcome.
      const existing = await this.repo.find(tx, userId, photographerId);
      if (!existing) throw new Error(`block: ${userId} → ${photographerId} vanished`);
      return existing;
    }) as Promise<BlockRecord>;
  }

  /** Idempotent: unblocking someone not blocked changes nothing and emits nothing. */
  async unblock(userId: string, photographerId: string, now: Date): Promise<void> {
    await this.sql.begin(async (tx) => {
      const removed = await this.repo.remove(tx, userId, photographerId);
      if (removed) {
        await this.emit(
          tx,
          'client_block.removed',
          { userId, photographerId, createdAt: now },
          now,
        );
      }
    });
  }

  private emit(
    tx: Tx,
    eventType: 'client_block.added' | 'client_block.removed',
    b: BlockRecord,
    now: Date,
  ): Promise<void> {
    return appendDomainEvent(tx, {
      eventType,
      aggregateKind: 'user',
      aggregateId: b.userId,
      occurredAt: now,
      payload: { user_id: b.userId, photographer_id: b.photographerId },
    });
  }

  private async withNames(blocks: readonly BlockRecord[]): Promise<BlockedView[]> {
    const names = await this.photographers.displayNames(blocks.map((b) => b.photographerId));
    return blocks.map((b) => ({
      photographerId: b.photographerId,
      name: names.get(b.photographerId) ?? 'Photographer',
      blockedAt: b.createdAt,
    }));
  }
}
