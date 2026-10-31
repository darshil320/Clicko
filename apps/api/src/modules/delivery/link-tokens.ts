import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

const DEV_INFO = 'clickco/delivery-link-key/development';

/** sha256 hex of a public token: what delivery_links stores (audit L2). */
export const tokenSha256 = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Audit L2: the public token of a `/d/<token>` link is derived, not stored —
 * base64url(HMAC-SHA256(DELIVERY_LINK_KEY, link id)), 43 characters like the random tokens it
 * replaces. delivery_links keeps only its sha256, so a copy of the database opens nothing, and
 * the owner can still be shown the same link again. Development and test derive the key from
 * JWT_ACCESS_SECRET (env.ts requires a dedicated key when deployed).
 */
@Injectable()
export class DeliveryLinkTokens {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Pick<Env, 'DELIVERY_LINK_KEY' | 'JWT_ACCESS_SECRET'>) {
    this.key = env.DELIVERY_LINK_KEY
      ? Buffer.from(env.DELIVERY_LINK_KEY, 'utf8')
      : Buffer.from(
          hkdfSync('sha256', Buffer.from(env.JWT_ACCESS_SECRET), Buffer.alloc(0), DEV_INFO, 32),
        );
  }

  tokenFor(linkId: string): string {
    return createHmac('sha256', this.key).update(`delivery-link:${linkId}`).digest('base64url');
  }

  /** The derived token of `linkId`, only if it still matches the stored hash (else null). */
  tokenIfCurrent(linkId: string, storedSha256: string): string | null {
    const token = this.tokenFor(linkId);
    const a = Buffer.from(tokenSha256(token), 'hex');
    const b = Buffer.from(storedSha256, 'hex');
    return a.length === b.length && timingSafeEqual(a, b) ? token : null;
  }
}
