import type { DeliveryLinkKind } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { Db, DeliveryLinkRecord, Tx } from '../delivery.types';

interface Row {
  id: string;
  delivery_id: string;
  booking_id: string;
  kind: DeliveryLinkKind;
  public_token_sha256: string;
  provider_link: string;
  provider_link_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  access_count: number;
}

const COLUMNS = `id, delivery_id, booking_id, kind, public_token_sha256, provider_link, provider_link_id,
  expires_at, revoked_at, access_count`;

const toRecord = (r: Row): DeliveryLinkRecord => ({
  id: r.id,
  deliveryId: r.delivery_id,
  bookingId: r.booking_id,
  kind: r.kind,
  tokenSha256: r.public_token_sha256,
  providerLink: r.provider_link,
  providerLinkId: r.provider_link_id,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  accessCount: r.access_count,
});

export interface NewDeliveryLink {
  /** Chosen by the caller: the public token is derived from it (DeliveryLinkTokens). */
  readonly id: string;
  readonly deliveryId: string;
  readonly bookingId: string;
  readonly kind: DeliveryLinkKind;
  readonly tokenSha256: string;
  readonly providerLink: string;
  readonly providerLinkId: string;
  readonly expiresAt: Date;
}

/**
 * delivery_links (schema §9 + addendum 0012): the sha256 of our opaque token → the link, resolved
 * server-side. The provider link is kept for revocation only and never leaves the server.
 */
@Injectable()
export class DeliveryLinksRepository {
  async forBooking(db: Db, bookingId: string): Promise<DeliveryLinkRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM delivery_links WHERE booking_id = ${bookingId}
      ORDER BY kind, created_at`;
    return rows.map(toRecord);
  }

  async insert(tx: Tx, l: NewDeliveryLink): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO delivery_links (id, delivery_id, booking_id, kind, public_token_sha256,
                                  provider_link, provider_link_id, expires_at)
      VALUES (${l.id}, ${l.deliveryId}, ${l.bookingId}, ${l.kind}, ${l.tokenSha256},
              ${l.providerLink}, ${l.providerLinkId}, ${l.expiresAt})
      RETURNING id`;
    if (!row) throw new Error('delivery_links.insert: no row returned');
    return row.id;
  }

  async findByTokenSha256(db: Db, sha256: string): Promise<DeliveryLinkRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM delivery_links WHERE public_token_sha256 = ${sha256}`;
    return row ? toRecord(row) : null;
  }

  async recordAccess(db: Db, id: string, at: Date): Promise<void> {
    await db`
      UPDATE delivery_links
         SET access_count = access_count + 1,
             first_accessed_at = coalesce(first_accessed_at, ${at}), last_accessed_at = ${at}
       WHERE id = ${id}`;
  }

  async markRevoked(db: Db, id: string, at: Date): Promise<void> {
    await db`UPDATE delivery_links SET revoked_at = ${at} WHERE id = ${id} AND revoked_at IS NULL`;
  }
}
