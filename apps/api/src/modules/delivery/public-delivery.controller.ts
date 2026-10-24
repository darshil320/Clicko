import type { LocalDeliveryLinkView } from '@clickco/contracts';
import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { ok } from '../../common/envelope';
import { SQL } from '../../infra/db/db.module';
import { DELIVERY_CONFIG } from './delivery.config';
import { linkExpired, linkNotFound } from './http-errors';
import { DeliveriesRepository } from './repositories/deliveries.repository';
import { DeliveryLinksRepository } from './repositories/delivery-links.repository';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Clickco's public delivery link (ADR-0016 D5): the opaque token is resolved server-side and the
 * browser is sent on to the provider link while it is valid — the provider link is never in a
 * response body. A local (development) link cannot be followed, so it is described instead.
 */
@Controller('d')
@Throttle({ default: { limit: DELIVERY_CONFIG.linkHitsPerMinutePerIp, ttl: 60_000 } })
export class PublicDeliveryController {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DeliveryLinksRepository) private readonly links: DeliveryLinksRepository,
    @Inject(DeliveriesRepository) private readonly deliveries: DeliveriesRepository,
  ) {}

  @Get(':token')
  async open(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    if (!TOKEN.test(token)) throw linkNotFound();
    const link = await this.links.findByToken(this.sql, token);
    if (!link) throw linkNotFound();
    const now = this.clock();
    if (link.revokedAt || link.expiresAt <= now) throw linkExpired();
    await this.links.recordAccess(this.sql, link.id, now);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (link.providerLink.startsWith('https://')) {
      res.redirect(302, link.providerLink);
      return;
    }
    const delivery = await this.deliveries.find(this.sql, link.bookingId);
    const counts = { RAW_PHOTO: delivery?.raw, JPEG_PHOTO: delivery?.jpeg, VIDEO: delivery?.video };
    const view: LocalDeliveryLinkView = {
      kind: link.kind,
      expiresAt: link.expiresAt.toISOString(),
      fileCount: counts[link.kind]?.files ?? 0,
      note: 'Local storage: in production this opens the shared folder',
    };
    return ok(view);
  }
}
