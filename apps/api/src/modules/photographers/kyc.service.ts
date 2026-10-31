import { createHash, randomBytes } from 'node:crypto';
import type { KycDecision } from '@clickco/contracts';
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type postgres from 'postgres';
import type { TxHook } from '../../common/tx-hook';
import { ENV, type Env } from '../../config/env';
import { SQL } from '../../infra/db/db.module';
import { REDIS } from '../../infra/queues/redis';
import {
  StorageNotConfiguredError,
  StorageNotFoundError,
} from '../../infra/storage/storage.errors';
import { type ByteSource, STORAGE_PORT, type StoragePort } from '../../infra/storage/storage.port';
import { KycRepository } from './repositories/kyc.repository';
import type { CityScope, DocumentRecord, KycQueueRecord, VerificationRecord } from './supply.types';
import {
  covers,
  isDocumentExpired,
  istToday,
  KYC_LINK_TTL_MS,
  kycLinkExpiry,
  verificationEffect,
} from './supply-rules';

const NOT_FOUND = { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' };
const LINK_USED = {
  code: 'LINK_USED_OR_EXPIRED',
  message: 'This document link was already used or has expired. Open the document again.',
};
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

/** The path a KYC view token opens (GET, behind StaffGuard). */
export const KYC_VIEW_PATH = '/admin/supply/kyc/view/';

/** What a view token stands for (kept in Redis under the token's sha256, never the token). */
interface ViewGrant {
  readonly documentId: string;
  readonly staffId: string;
  readonly expiresAt: string;
}

/** A document opened through a view token: its facts and its bytes from StoragePort. */
export interface OpenedDocument {
  readonly document: DocumentRecord;
  readonly body: ByteSource;
}

/**
 * The KYC queue (ADR-0026 D5). Audit M2: a document is never opened through a provider URL. Staff
 * get an opaque, single-use token (only its sha256 is kept, in Redis, for 5 minutes, bound to
 * the staff member who asked) for `GET /admin/supply/kyc/view/:token`, which streams the bytes
 * from StoragePort. Issuing (`kyc.document_view`) and every open (`kyc.document_opened`) are
 * audited. Approving an identity, PAN, bank or police document ticks that manual check.
 */
@Injectable()
export class KycService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(KycRepository) private readonly repo: KycRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private grantKey(token: string): string {
    return `${this.env.QUEUE_PREFIX}:kyc-view:${sha256(token)}`;
  }

  queue(q: {
    readonly scope: CityScope;
    readonly after?: { readonly uploadedAt: Date; readonly id: string };
    readonly limit: number;
  }): Promise<KycQueueRecord[]> {
    return this.repo.queue(this.sql, q);
  }

  /**
   * A single-use, 5-minute view token for one document, bound to `staffId`. The audit row
   * (`kyc.document_view`) commits before the token leaves.
   */
  async issueViewToken(v: {
    readonly id: string;
    readonly scope: CityScope;
    readonly staffId: string;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<{ readonly path: string; readonly expiresAt: Date }> {
    const doc = await this.viewable(v.id, v.scope);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = kycLinkExpiry(v.now);
    const grant: ViewGrant = {
      documentId: doc.id,
      staffId: v.staffId,
      expiresAt: expiresAt.toISOString(),
    };
    await this.redisOp(() =>
      this.redis.set(this.grantKey(token), JSON.stringify(grant), 'PX', KYC_LINK_TTL_MS, 'NX'),
    );
    await this.sql.begin((tx) =>
      v.audit(tx, {
        before: null,
        after: {
          photographer_id: doc.photographerId,
          kind: doc.kind,
          link_expires_at: expiresAt.toISOString(),
        },
      }),
    );
    return { path: `${KYC_VIEW_PATH}${token}`, expiresAt };
  }

  /**
   * Consumes a view token atomically (GETDEL: a second open, or another staff member's, finds
   * nothing — 410) and opens the document's bytes. Scope and purge are checked again now.
   */
  async openWithToken(o: {
    readonly token: string;
    readonly staffId: string;
    readonly scope: CityScope;
    readonly now: Date;
  }): Promise<OpenedDocument> {
    if (!TOKEN.test(o.token)) throw new GoneException(LINK_USED);
    const raw = await this.redisOp(() => this.redis.getdel(this.grantKey(o.token)));
    const grant = parseGrant(raw);
    if (!grant || grant.staffId !== o.staffId || Date.parse(grant.expiresAt) <= o.now.getTime()) {
      throw new GoneException(LINK_USED);
    }
    const document = await this.viewable(grant.documentId, o.scope);
    return { document, body: await this.open(document.storageKey) };
  }

  private async viewable(id: string, scope: CityScope): Promise<DocumentRecord> {
    const doc = await this.repo.find(this.sql, id);
    if (!doc || !covers(scope, doc.cityId)) throw new NotFoundException(NOT_FOUND);
    if (doc.purgedAt) {
      throw new NotFoundException({
        code: 'DOCUMENT_PURGED',
        message: 'This document was deleted under the retention policy',
      });
    }
    return doc;
  }

  /** The token store is Redis: without it, fail closed with a clear 503. */
  private async redisOp<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch {
      throw new ServiceUnavailableException({
        code: 'STORAGE_UNAVAILABLE',
        message: 'Documents cannot be opened right now. Try again later.',
      });
    }
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

  private async open(storageKey: string): Promise<ByteSource> {
    try {
      return await this.storage.openObject(storageKey);
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

function parseGrant(raw: string | null): ViewGrant | null {
  if (!raw) return null;
  try {
    const g = JSON.parse(raw) as Partial<ViewGrant>;
    return typeof g.documentId === 'string' &&
      typeof g.staffId === 'string' &&
      typeof g.expiresAt === 'string'
      ? { documentId: g.documentId, staffId: g.staffId, expiresAt: g.expiresAt }
      : null;
  } catch {
    return null;
  }
}
