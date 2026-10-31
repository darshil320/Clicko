import { Readable } from 'node:stream';
import { type DeliveryFolderView, Uuid } from '@clickco/contracts';
import { Controller, Get, Inject, Param, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { ok } from '../../common/envelope';
import { SQL } from '../../infra/db/db.module';
import { MediaRetentionService } from '../media/media-retention.service';
import { DELIVERY_CONFIG } from './delivery.config';
import type { DeliveryLinkRecord } from './delivery.types';
import { linkExpired, linkNotFound } from './http-errors';
import { tokenSha256 } from './link-tokens';
import { DeliveryLinksRepository } from './repositories/delivery-links.repository';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** A filename safe in a Content-Disposition header (ASCII fallback + RFC 5987 UTF-8 form). */
export function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Clickco's public delivery link (ADR-0016 D5, audit M5). The opaque token is resolved
 * server-side (by its sha256, audit L2); the files behind it are listed and STREAMED THROUGH
 * CLICKCO via StoragePort — the API never redirects to the storage provider, so no provider URL
 * (and no provider-side sharing) ever reaches a browser. Every open is counted.
 */
@Controller('d')
@Throttle({ default: { limit: DELIVERY_CONFIG.linkHitsPerMinutePerIp, ttl: 60_000 } })
export class PublicDeliveryController {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DeliveryLinksRepository) private readonly links: DeliveryLinksRepository,
    @Inject(MediaRetentionService) private readonly media: MediaRetentionService,
  ) {}

  private async live(token: string): Promise<DeliveryLinkRecord> {
    if (!TOKEN.test(token)) throw linkNotFound();
    const link = await this.links.findByTokenSha256(this.sql, tokenSha256(token));
    if (!link) throw linkNotFound();
    if (link.revokedAt || link.expiresAt <= this.clock()) throw linkExpired();
    return link;
  }

  private static private(res: Response): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  @Get(':token')
  async open(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    const link = await this.live(token);
    await this.links.recordAccess(this.sql, link.id, this.clock());
    PublicDeliveryController.private(res);
    const files = await this.media.deliverable(link.bookingId, link.kind);
    const view: DeliveryFolderView = {
      kind: link.kind,
      expiresAt: link.expiresAt.toISOString(),
      fileCount: files.length,
      totalBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
      files: files.map((f) => ({
        id: f.id,
        name: f.originalFilename,
        sizeBytes: f.sizeBytes,
        contentType: f.mimeType ?? 'application/octet-stream',
        path: `${DELIVERY_CONFIG.publicPathPrefix}${token}/files/${f.id}`,
      })),
    };
    return ok(view);
  }

  /** One file's bytes, streamed from StoragePort — always as a download, never rendered. */
  @Get(':token/files/:fileId')
  async file(
    @Param('token') token: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const link = await this.live(token);
    if (!Uuid.safeParse(fileId).success) throw linkNotFound();
    const opened = await this.media.openDeliverable(link.bookingId, link.kind, fileId);
    if (!opened) throw linkNotFound();
    PublicDeliveryController.private(res);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(Readable.from(opened.body), {
      type: 'application/octet-stream',
      length: opened.asset.sizeBytes,
      disposition: attachmentHeader(opened.asset.originalFilename),
    });
  }
}
