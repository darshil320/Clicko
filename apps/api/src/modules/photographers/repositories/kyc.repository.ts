import type {
  ApplicationStage,
  DocumentKind,
  DocumentReviewStatus,
  PhotographerStatus,
} from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type {
  CityScope,
  DocumentRecord,
  KycQueueRecord,
  Tx,
  VerificationRecord,
} from '../supply.types';
import {
  and,
  cityClause,
  type Db,
  DOCUMENT_COLUMNS,
  type DocumentRow,
  toDocument,
  toVerification,
  VERIFICATION_COLUMNS,
  type VerificationRow,
} from './supply-rows';

interface QueueRow extends DocumentRow {
  full_name: string;
  status: PhotographerStatus;
  city_id: string;
  application_stage: ApplicationStage | null;
}

export interface KycQueueQuery {
  readonly scope: CityScope;
  readonly after?: { readonly uploadedAt: Date; readonly id: string };
  readonly limit: number;
}

/** A document with the city of its photographer (for scope checks). */
export interface ScopedDocument extends DocumentRecord {
  readonly cityId: string;
}

export interface Verified {
  readonly check: 'IDENTITY' | 'PAN' | 'BANK' | 'POLICE';
  readonly kind: DocumentKind;
  readonly last4: string | null;
  readonly issuedOn: string | null;
  readonly expiresOn: string | null;
  readonly staffId: string;
  readonly at: Date;
  /** The IST day `at` falls on (police verification date when the document has none). */
  readonly today: string;
}

/**
 * photographer_documents (the KYC queue) and the manual verification ticks on photographers.
 * Never holds or returns a full identifier: last 4 only (Invariant 15).
 */
@Injectable()
export class KycRepository {
  /** PENDING, unpurged documents in the caller's cities, oldest first. */
  async queue(db: Db, q: KycQueueQuery): Promise<KycQueueRecord[]> {
    const where = [
      db`d.review_status = 'PENDING'`,
      db`d.purged_at IS NULL`,
      cityClause(db, q.scope),
      ...(q.after
        ? [db`(d.uploaded_at, d.id) > (${q.after.uploadedAt}, ${q.after.id}::uuid)`]
        : []),
    ];
    const rows = await db<QueueRow[]>`
      SELECT ${db.unsafe(DOCUMENT_COLUMNS)}, p.full_name, p.status, p.city_id,
             (SELECT a.stage FROM photographer_applications a WHERE a.photographer_id = p.id
              ORDER BY a.created_at DESC LIMIT 1) AS application_stage
      FROM photographer_documents d JOIN photographers p ON p.id = d.photographer_id
      WHERE ${and(db, where)}
      ORDER BY d.uploaded_at, d.id
      LIMIT ${q.limit}`;
    return rows.map((r) => ({
      ...toDocument(r),
      photographerName: r.full_name,
      photographerStatus: r.status,
      cityId: r.city_id,
      applicationStage: r.application_stage,
    }));
  }

  async find(db: Db, id: string): Promise<ScopedDocument | null> {
    const [row] = await db<Array<DocumentRow & { city_id: string }>>`
      SELECT ${db.unsafe(DOCUMENT_COLUMNS)}, p.city_id
      FROM photographer_documents d JOIN photographers p ON p.id = d.photographer_id
      WHERE d.id = ${id}`;
    return row ? { ...toDocument(row), cityId: row.city_id } : null;
  }

  async lock(tx: Tx, id: string): Promise<ScopedDocument | null> {
    const [row] = await tx<Array<DocumentRow & { city_id: string }>>`
      SELECT ${tx.unsafe(DOCUMENT_COLUMNS)}, p.city_id
      FROM photographer_documents d JOIN photographers p ON p.id = d.photographer_id
      WHERE d.id = ${id}
      FOR UPDATE OF d, p`;
    return row ? { ...toDocument(row), cityId: row.city_id } : null;
  }

  async review(
    tx: Tx,
    id: string,
    r: {
      readonly status: DocumentReviewStatus;
      readonly staffId: string;
      readonly note: string | null;
      readonly at: Date;
    },
  ): Promise<void> {
    await tx`
      UPDATE photographer_documents
      SET review_status = ${r.status}, reviewed_by = ${r.staffId}, reviewed_at = ${r.at},
          review_note = ${r.note}
      WHERE id = ${id}`;
  }

  /** Ticks one manual check from an approved document (latest approval wins). */
  async markVerified(tx: Tx, photographerId: string, v: Verified): Promise<void> {
    switch (v.check) {
      case 'IDENTITY':
        await tx`
          UPDATE photographers
          SET identity_confirmed_at = ${v.at}, identity_confirmed_by = ${v.staffId},
              id_proof_kind = ${v.kind}, id_proof_last4 = ${v.last4}
          WHERE id = ${photographerId}`;
        return;
      case 'PAN':
        await tx`UPDATE photographers SET pan_verified_at = ${v.at} WHERE id = ${photographerId}`;
        return;
      case 'BANK':
        await tx`UPDATE photographers SET bank_verified_at = ${v.at} WHERE id = ${photographerId}`;
        return;
      case 'POLICE':
        await tx`
          UPDATE photographers
          SET police_verification_at = ${v.issuedOn ?? v.today}::date,
              police_verification_expires = ${v.expiresOn}::date
          WHERE id = ${photographerId}`;
        return;
    }
  }

  async verification(db: Db, photographerId: string): Promise<VerificationRecord | null> {
    const [row] = await db<VerificationRow[]>`
      SELECT ${db.unsafe(VERIFICATION_COLUMNS)} FROM photographers p WHERE p.id = ${photographerId}`;
    return row ? toVerification(row) : null;
  }

  async documentsOf(db: Db, photographerId: string): Promise<DocumentRecord[]> {
    const rows = await db<DocumentRow[]>`
      SELECT ${db.unsafe(DOCUMENT_COLUMNS)} FROM photographer_documents d
      WHERE d.photographer_id = ${photographerId} AND d.purged_at IS NULL
      ORDER BY d.uploaded_at DESC, d.id`;
    return rows.map(toDocument);
  }

  /** PENDING, unpurged documents in the caller's cities — the Today count. */
  async countPending(db: Db, scope: CityScope): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM photographer_documents d JOIN photographers p ON p.id = d.photographer_id
      WHERE d.review_status = 'PENDING' AND d.purged_at IS NULL AND ${cityClause(db, scope)}`;
    return row?.n ?? 0;
  }
}
