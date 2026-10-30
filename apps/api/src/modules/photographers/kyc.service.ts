import type { KycDecision } from '@clickco/contracts';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import {
  StorageNotConfiguredError,
  StorageNotFoundError,
} from '../../infra/storage/storage.errors';
import { type ReadLink, STORAGE_PORT, type StoragePort } from '../../infra/storage/storage.port';
import { KycRepository } from './repositories/kyc.repository';
import type { CityScope, DocumentRecord, KycQueueRecord, VerificationRecord } from './supply.types';
import {
  covers,
  isDocumentExpired,
  istToday,
  kycLinkExpiry,
  verificationEffect,
} from './supply-rules';

const NOT_FOUND = { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' };

/**
 * The KYC queue (ADR-0026 D5). A document is only ever opened through a 5-minute signed link from
 * the StoragePort, and every link issued is audited (`kyc.document_view`) before it is returned.
 * Approving an identity, PAN, bank or police document ticks that manual check on the photographer.
 */
@Injectable()
export class KycService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(KycRepository) private readonly repo: KycRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  queue(q: {
    readonly scope: CityScope;
    readonly after?: { readonly uploadedAt: Date; readonly id: string };
    readonly limit: number;
  }): Promise<KycQueueRecord[]> {
    return this.repo.queue(this.sql, q);
  }

  /** A 5-minute read link; the audit row commits before the link leaves. */
  async viewLink(v: {
    readonly id: string;
    readonly scope: CityScope;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<ReadLink> {
    const doc = await this.repo.find(this.sql, v.id);
    if (!doc || !covers(v.scope, doc.cityId)) throw new NotFoundException(NOT_FOUND);
    if (doc.purgedAt) {
      throw new NotFoundException({
        code: 'DOCUMENT_PURGED',
        message: 'This document was deleted under the retention policy',
      });
    }
    const link = await this.readLink(doc.storageKey, kycLinkExpiry(v.now));
    await this.sql.begin((tx) =>
      v.audit(tx, {
        before: null,
        after: {
          photographer_id: doc.photographerId,
          kind: doc.kind,
          link_expires_at: link.expiresAt.toISOString(),
        },
      }),
    );
    return link;
  }

  async decide(d: {
    readonly id: string;
    readonly decision: KycDecision;
    readonly note: string | null;
    readonly staffId: string;
    readonly scope: CityScope;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<{ document: DocumentRecord; verification: VerificationRecord }> {
    await this.sql.begin(async (tx) => {
      const doc = await this.repo.lock(tx, d.id);
      if (!doc || !covers(d.scope, doc.cityId)) throw new NotFoundException(NOT_FOUND);
      if (doc.reviewStatus !== 'PENDING' || doc.purgedAt) {
        throw new ConflictException({
          code: 'DOCUMENT_ALREADY_REVIEWED',
          message: 'This document has already been reviewed',
        });
      }
      const today = istToday(d.now);
      if (d.decision === 'APPROVE' && isDocumentExpired(doc.expiresOn, today)) {
        throw new UnprocessableEntityException({
          code: 'DOCUMENT_EXPIRED',
          message: 'This document has expired. Reject it and ask for a current one.',
        });
      }
      if (
        d.decision === 'APPROVE' &&
        verificationEffect(doc.kind) === 'IDENTITY' &&
        doc.referenceLast4 === null
      ) {
        throw new UnprocessableEntityException({
          code: 'ID_LAST4_MISSING',
          message: 'This ID has no last four characters on file. Ask for a clearer copy.',
        });
      }
      const status = d.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await this.repo.review(tx, d.id, { status, staffId: d.staffId, note: d.note, at: d.now });
      const check = d.decision === 'APPROVE' ? verificationEffect(doc.kind) : null;
      if (check) {
        await this.repo.markVerified(tx, doc.photographerId, {
          check,
          kind: doc.kind,
          last4: doc.referenceLast4,
          issuedOn: doc.issuedOn,
          expiresOn: doc.expiresOn,
          staffId: d.staffId,
          at: d.now,
          today,
        });
      }
      await d.audit(tx, {
        before: { review_status: 'PENDING', kind: doc.kind },
        after: { review_status: status, kind: doc.kind, note: d.note, verified: check },
      });
    });
    const [document, verification] = await Promise.all([
      this.repo.find(this.sql, d.id),
      this.verificationOf(d.id),
    ]);
    if (!document || !verification) throw new NotFoundException(NOT_FOUND);
    return { document, verification };
  }

  /** Today: documents waiting for a decision in these cities. */
  countPending(scope: CityScope): Promise<number> {
    return this.repo.countPending(this.sql, scope);
  }

  private async verificationOf(documentId: string): Promise<VerificationRecord | null> {
    const doc = await this.repo.find(this.sql, documentId);
    return doc ? this.repo.verification(this.sql, doc.photographerId) : null;
  }

  private async readLink(storageKey: string, expiresAt: Date): Promise<ReadLink> {
    try {
      return await this.storage.createReadLink(storageKey, expiresAt);
    } catch (error) {
      if (error instanceof StorageNotFoundError) {
        throw new NotFoundException({
          code: 'DOCUMENT_FILE_MISSING',
          message:
            'The file for this document is missing. Ask the photographer to upload it again.',
        });
      }
      if (error instanceof StorageNotConfiguredError) {
        throw new ServiceUnavailableException({
          code: 'STORAGE_UNAVAILABLE',
          message: 'Documents cannot be opened right now. Try again later.',
        });
      }
      throw error;
    }
  }
}
