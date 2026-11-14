import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { STORAGE_PORT, type StoragePort } from '../../infra/storage/storage.port';
import {
  KYC_EVENTS,
  KYC_RETENTION,
  type KycPurgeReason,
  kycPurgeAfter,
} from './kyc-retention.config';
import { type DuePurge, KycRepository } from './repositories/kyc.repository';
import type { Tx } from './supply.types';
import { istToday } from './supply-rules';

export interface KycSweepResult {
  readonly purged: number;
  readonly failed: number;
}

const DAYS: Readonly<Record<KycPurgeReason, number>> = {
  OFFBOARDED: KYC_RETENTION.daysAfterRelationshipEnds,
  APPLICATION_REJECTED: KYC_RETENTION.daysAfterApplicationClosed,
  APPLICATION_WITHDRAWN: KYC_RETENTION.daysAfterApplicationClosed,
};

/**
 * DPDP retention for KYC documents (schema §6: "Purge when the relationship ends").
 *  - `schedule` / `cancel` run inside the caller's transaction (offboarding, an application
 *    rejected, withdrawn or reopened) and emit their outbox event there (rule 7).
 *  - `sweep` is the scheduled job (`supply.kyc-purge`, src/jobs/): one batch of documents due on
 *    the IST day. Each is locked, its file permanently deleted through StoragePort (Invariants 24,
 *    25; unknown ids are ignored, so a rerun is harmless), then marked purged with its identifiers
 *    erased and a `photographer_document.purged` event — all in one transaction, so a failed
 *    delete changes nothing and the document is tried again next run. One failure never stops the
 *    batch; logs carry only the document id and the error class, never a file name or key.
 */
@Injectable()
export class KycRetentionService {
  private readonly logger = new Logger(KycRetentionService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(KycRepository) private readonly repo: KycRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async schedule(
    tx: Tx,
    s: { readonly photographerId: string; readonly reason: KycPurgeReason; readonly now: Date },
  ): Promise<number> {
    const purgeAfter = kycPurgeAfter(s.now, DAYS[s.reason]);
    const documents = await this.repo.schedulePurge(tx, s.photographerId, purgeAfter);
    if (documents > 0) {
      await appendDomainEvent(tx, {
        eventType: KYC_EVENTS.SCHEDULED,
        aggregateKind: 'photographer',
        aggregateId: s.photographerId,
        payload: {
          photographer_id: s.photographerId,
          purge_after: purgeAfter,
          documents,
          reason: s.reason,
        },
        occurredAt: s.now,
      });
    }
    return documents;
  }

  async cancel(
    tx: Tx,
    c: { readonly photographerId: string; readonly now: Date },
  ): Promise<number> {
    const documents = await this.repo.cancelPurge(tx, c.photographerId);
    if (documents > 0) {
      await appendDomainEvent(tx, {
        eventType: KYC_EVENTS.CANCELLED,
        aggregateKind: 'photographer',
        aggregateId: c.photographerId,
        payload: { photographer_id: c.photographerId, documents },
        occurredAt: c.now,
      });
    }
    return documents;
  }

  async sweep(): Promise<KycSweepResult> {
    const now = this.clock();
    const today = istToday(now);
    const due = await this.repo.dueForPurge(this.sql, today, KYC_RETENTION.purgeBatch);
    let purged = 0;
    let failed = 0;
    for (const doc of due) {
      try {
        if (await this.purgeOne(doc.id, today, now)) purged += 1;
      } catch (error) {
        failed += 1;
        const name = error instanceof Error ? error.name : 'UnknownError';
        this.logger.warn(`KYC purge failed for document ${doc.id}: ${name}; retried next run`);
      }
    }
    if (purged > 0 || failed > 0) {
      this.logger.log(`KYC retention sweep: ${purged} document(s) purged, ${failed} failed`);
    }
    return { purged, failed };
  }

  private purgeOne(id: string, today: string, now: Date): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const doc = await this.repo.lockDueForPurge(tx, id, today);
      if (!doc) return false;
      await this.storage.permanentlyDelete([doc.storageKey]);
      if (!(await this.repo.markPurged(tx, doc.id, now))) return false;
      await appendDomainEvent(tx, purgedEvent(doc, now));
      return true;
    });
  }
}

const purgedEvent = (doc: DuePurge, now: Date) => ({
  eventType: KYC_EVENTS.PURGED,
  aggregateKind: 'photographer_document',
  aggregateId: doc.id,
  payload: { photographer_id: doc.photographerId, kind: doc.kind, purged_at: now.toISOString() },
  occurredAt: now,
});
