import {
  ClientFileId,
  CompleteUploadFileBody,
  CreateUploadSessionBody,
  MEDIA_LIMITS,
  Uuid,
} from '@clickco/contracts';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { ProGuard } from '../../common/guards/pro.guard';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { badRequest, lengthRequired, unsupportedMediaType } from './http-errors';
import { MEDIA_CONFIG } from './media.config';
import { UploadJobsService } from './upload-jobs.service';
import { type IncomingPart, UploadPartsService } from './upload-parts.service';
import { UploadSessionsService } from './upload-sessions.service';

/** 8 GiB video / 8 MiB parts = 1,024; leave headroom. */
const PartNumber = z.coerce.number().int().min(1).max(4_096);
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MD5_BASE64 = /^[A-Za-z0-9+/]{22}==$/;

function photographerId(subject: Subject): string {
  if (subject.kind !== 'PHOTOGRAPHER') {
    throw new ForbiddenException({
      code: 'PHOTOGRAPHERS_ONLY',
      message: 'Only photographer accounts can use this',
    });
  }
  return subject.id;
}

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

/** Reads the request's raw byte stream itself (no body parser, no buffering — ADR-0014 D2). */
function incomingPart(req: Request): IncomingPart {
  const type = header(req, 'content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/octet-stream')) throw unsupportedMediaType();
  const rawLength = header(req, 'content-length');
  if (rawLength === undefined || !/^\d+$/.test(rawLength)) throw lengthRequired();
  const contentLength = Number.parseInt(rawLength, 10);
  if (contentLength < 1 || contentLength > MEDIA_LIMITS.maxPartBytes) {
    throw badRequest('PART_TOO_LARGE', `A part must be 1–${MEDIA_LIMITS.maxPartBytes} bytes`);
  }
  const sha256 = header(req, 'x-part-sha256')?.toLowerCase();
  const md5Base64 = header(req, 'content-md5');
  if (sha256 !== undefined && !SHA256_HEX.test(sha256)) {
    throw badRequest('INVALID_PART_CHECKSUM', 'X-Part-Sha256 must be a hex SHA-256');
  }
  if (md5Base64 !== undefined && !MD5_BASE64.test(md5Base64)) {
    throw badRequest('INVALID_PART_CHECKSUM', 'Content-MD5 must be a base64 MD5');
  }
  if (sha256 === undefined && md5Base64 === undefined) {
    throw badRequest(
      'PART_CHECKSUM_REQUIRED',
      'Send X-Part-Sha256 (or Content-MD5) with every part',
    );
  }
  return {
    body: req,
    contentLength,
    ...(sha256 === undefined ? {} : { sha256 }),
    ...(md5Base64 === undefined ? {} : { md5Base64 }),
    discard: () =>
      new Promise<void>((resolve) => {
        if (req.readableEnded) return resolve();
        req.once('end', () => resolve());
        req.once('error', () => resolve());
        req.resume();
      }),
  };
}

/**
 * The photographer upload surface (ADR-0014 D2) used by apps/portal. Own assignment only; every
 * mutating POST is idempotent; part PUTs are idempotent by part number + hash.
 */
@Controller('pro')
@UseGuards(ProGuard)
@Throttle({ default: { limit: MEDIA_CONFIG.routesPerMinutePerIp, ttl: 60_000 } })
export class ProUploadsController {
  constructor(
    @Inject(UploadSessionsService) private readonly sessions: UploadSessionsService,
    @Inject(UploadPartsService) private readonly parts: UploadPartsService,
    @Inject(UploadJobsService) private readonly jobs: UploadJobsService,
  ) {}

  @Get('upload-jobs')
  async uploadJobs(@CurrentSubject() subject: Subject) {
    return ok(await this.jobs.list(photographerId(subject)));
  }

  @Post('bookings/:bookingId/upload-sessions')
  @HttpCode(201)
  @Idempotent({ ttlMs: MEDIA_CONFIG.proIdempotencyTtlMs })
  async createSession(
    @CurrentSubject() subject: Subject,
    @Param('bookingId', new ZodValidationPipe(Uuid)) bookingId: string,
    @Body(new ZodValidationPipe(CreateUploadSessionBody)) body: CreateUploadSessionBody,
  ) {
    return ok(await this.sessions.create(photographerId(subject), bookingId, body));
  }

  @Get('upload-sessions/:sessionId')
  async session(
    @CurrentSubject() subject: Subject,
    @Param('sessionId', new ZodValidationPipe(Uuid)) sessionId: string,
  ) {
    return ok(await this.sessions.view(photographerId(subject), sessionId));
  }

  @Put('upload-sessions/:sessionId/files/:fileId/parts/:partNumber')
  @Throttle({ default: { limit: MEDIA_CONFIG.partsPerMinutePerIp, ttl: 60_000 } })
  async putPart(
    @CurrentSubject() subject: Subject,
    @Param('sessionId', new ZodValidationPipe(Uuid)) sessionId: string,
    @Param('fileId', new ZodValidationPipe(ClientFileId)) fileId: string,
    @Param('partNumber', new ZodValidationPipe(PartNumber)) partNumber: number,
    @Req() req: Request,
  ) {
    const part = incomingPart(req);
    return ok(
      await this.parts.putPart(photographerId(subject), sessionId, fileId, partNumber, part),
    );
  }

  @Post('upload-sessions/:sessionId/files/:fileId/complete')
  @HttpCode(200)
  @Idempotent({ ttlMs: MEDIA_CONFIG.proIdempotencyTtlMs })
  async completeFile(
    @CurrentSubject() subject: Subject,
    @Param('sessionId', new ZodValidationPipe(Uuid)) sessionId: string,
    @Param('fileId', new ZodValidationPipe(ClientFileId)) fileId: string,
    @Body(new ZodValidationPipe(CompleteUploadFileBody)) body: CompleteUploadFileBody,
  ) {
    return ok(
      await this.parts.completeFile(photographerId(subject), sessionId, fileId, body.sha256),
    );
  }

  @Post('upload-sessions/:sessionId/complete')
  @HttpCode(200)
  @Idempotent({ ttlMs: MEDIA_CONFIG.proIdempotencyTtlMs })
  async completeSession(
    @CurrentSubject() subject: Subject,
    @Param('sessionId', new ZodValidationPipe(Uuid)) sessionId: string,
  ) {
    return ok(await this.sessions.complete(photographerId(subject), sessionId));
  }

  @Post('upload-sessions/:sessionId/abort')
  @HttpCode(200)
  @Idempotent({ ttlMs: MEDIA_CONFIG.proIdempotencyTtlMs })
  async abort(
    @CurrentSubject() subject: Subject,
    @Param('sessionId', new ZodValidationPipe(Uuid)) sessionId: string,
  ) {
    return ok(await this.sessions.abort(photographerId(subject), sessionId));
  }
}
