import {
  type AbortUploadSessionResponse,
  type CompleteUploadSessionResponse,
  type CreateUploadSessionBody,
  MEDIA_LIMITS,
  type UploadFileDeclaration,
  type UploadSessionView,
} from '@clickco/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { folderFor, planRawFolders, yearMonthIst } from '../../infra/storage/folder-layout';
import {
  STORAGE_PORT,
  type StoragePort,
  type StorageUsage,
} from '../../infra/storage/storage.port';
import { BookingsService } from '../bookings/bookings.service';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import { AssignmentReads } from '../dispatch/assignment-reads.service';
import { capacityProblem } from './capacity';
import {
  bookingNotFound,
  conflict,
  sessionNotFound,
  unavailable,
  unprocessable,
} from './http-errors';
import { manifestMessage, validateManifest } from './manifest';
import { MEDIA_CONFIG, STORAGE_AGGREGATE_ID, UPLOADABLE_STATUSES } from './media.config';
import type { UploadBookingFacts, UploadSessionRecord } from './media.types';
import { appendMediaAlert } from './ops-alert';
import { reconcileSession } from './reconcile';
import { MediaAssetsRepository } from './repositories/media-assets.repository';
import { MediaOpsRepository } from './repositories/media-ops.repository';
import { UploadSessionsRepository } from './repositories/upload-sessions.repository';
import { buildSessionDoc, type FilePlan, fileStates, unverifiedFiles } from './session-doc';
import { contentTypeFor, storageKindOf, toHttpError } from './storage-files';
import { UploadBookings } from './upload-bookings';

const OPEN_STATUSES = ['OPEN', 'UPLOADING'] as const;
const isOpen = (s: UploadSessionRecord): boolean =>
  (OPEN_STATUSES as readonly string[]).includes(s.status);

export function toSessionView(s: UploadSessionRecord): UploadSessionView {
  return {
    sessionId: s.id,
    bookingId: s.bookingId,
    status: s.status,
    partSizeBytes: s.doc.partSizeBytes,
    declaredFrameCount: s.doc.declaredFrameCount,
    declaredFileCount: s.declaredFileCount,
    declaredBytes: s.declaredBytes,
    receivedFileCount: s.receivedFileCount,
    receivedBytes: s.receivedBytes,
    startedAt: s.startedAt.toISOString(),
    lastActivityAt: s.lastActivityAt.toISOString(),
    completedAt: s.completedAt?.toISOString() ?? null,
    failureReason: s.failureReason,
    files: fileStates(s.doc),
  };
}

/**
 * Upload sessions on the web portal (ADR-0014 D2): open (first one moves the booking CHECKED_OUT →
 * UPLOADING), resume view, reconcile + complete (UPLOADING → PROCESSING), abort.
 */
@Injectable()
export class UploadSessionsService {
  private readonly logger = new Logger(UploadSessionsService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(UploadBookings) private readonly uploadBookings: UploadBookings,
    @Inject(UploadSessionsRepository) private readonly sessions: UploadSessionsRepository,
    @Inject(MediaAssetsRepository) private readonly assets: MediaAssetsRepository,
    @Inject(MediaOpsRepository) private readonly ops: MediaOpsRepository,
  ) {}

  // ── open ─────────────────────────────────────────────────────────────────

  async create(
    photographerId: string,
    bookingId: string,
    body: CreateUploadSessionBody,
  ): Promise<UploadSessionView> {
    const engagement = await this.assignments.engagementFor(photographerId, bookingId);
    if (!engagement) throw bookingNotFound();
    const booking = await this.uploadBookings.one(bookingId);
    if (!booking) throw bookingNotFound();
    this.assertUploadable(booking.status);

    const hasVideo = body.files.some((f) => f.kind === 'VIDEO');
    const videoEnabled =
      hasVideo && (await this.ops.flagEnabled(this.sql, 'video_uploads', booking.cityId));
    const manifest = validateManifest(body.files, body.declaredFrameCount, { videoEnabled });
    if (!manifest.ok) {
      throw unprocessable(
        manifest.problem.code,
        manifestMessage(manifest.problem),
        manifest.problem,
      );
    }
    const active = await this.sessions.activeForBooking(this.sql, bookingId);
    if (active) throw this.activeConflict(active.id);
    await this.assertCapacity(manifest.summary.declaredBytes, bookingId);

    const plans = await this.openStorageSessions(booking, body.files);
    const now = this.clock();
    try {
      const record = await this.sql.begin(async (tx) => {
        const locked = await this.bookings.lock(tx, bookingId);
        this.assertUploadable(locked.status);
        const again = await this.sessions.activeForBooking(tx, bookingId);
        if (again) throw this.activeConflict(again.id);
        const session = await this.sessions.insert(tx, {
          bookingId,
          photographerId,
          declaredFileCount: manifest.summary.fileCount,
          declaredBytes: manifest.summary.declaredBytes,
          doc: buildSessionDoc({
            partSizeBytes: MEDIA_LIMITS.partSizeBytes,
            declaredFrameCount: body.declaredFrameCount,
            checkoutDeclaredFrames: engagement.declaredFrameCount,
            files: plans,
          }),
          now,
        });
        if (locked.status === 'CHECKED_OUT' || locked.status === 'UNSAFE_SITE') {
          await this.bookings.transition(tx, {
            bookingId,
            to: 'UPLOADING',
            actor: { kind: 'PHOTOGRAPHER', id: photographerId },
            occurredAt: now,
            reason: 'Upload session opened on the web portal',
            metadata: { upload_session_id: session.id },
            payload: {
              upload_session_id: session.id,
              assignment_id: engagement.assignmentId,
              declared_file_count: manifest.summary.fileCount,
              declared_bytes: manifest.summary.declaredBytes,
              declared_frame_count: body.declaredFrameCount,
            },
          });
        }
        return session;
      });
      return toSessionView(record);
    } catch (error) {
      await this.abortStorageSessions(plans.map((p) => p.storageSessionId));
      throw error;
    }
  }

  private assertUploadable(status: string): void {
    if (!(UPLOADABLE_STATUSES as readonly string[]).includes(status)) {
      throw conflict(
        'BOOKING_NOT_UPLOADABLE',
        status === 'PROCESSING' || status === 'QA'
          ? 'This shoot is already uploaded'
          : 'Uploads open after check-out',
        { bookingStatus: status },
      );
    }
  }

  private activeConflict(sessionId: string) {
    return conflict(
      'UPLOAD_SESSION_ACTIVE',
      'An upload is already in progress for this shoot — resume it',
      { sessionId },
    );
  }

  /** Doc 02 §6: refuse new sessions past 85 % of the daily ceiling, and when storage cannot hold it. */
  private async assertCapacity(declaredBytes: number, bookingId: string): Promise<void> {
    let usage: StorageUsage;
    try {
      usage = await this.storage.getUsage();
    } catch (error) {
      throw toHttpError(error);
    }
    const reserved = await this.sessions.outstandingBytes(this.sql);
    const now = this.clock();
    const code = capacityProblem(usage, declaredBytes, reserved);
    if (code === null) return;
    const full = code === 'STORAGE_FULL';
    await this.sql.begin((tx) =>
      appendMediaAlert(tx, {
        aggregateKind: 'storage',
        aggregateId: STORAGE_AGGREGATE_ID[this.storage.adapterId] as string,
        severity: full ? 'CRITICAL' : 'HIGH',
        sourceEventType: full ? 'storage.full' : 'storage.daily_ceiling_reached',
        dedupeKey: `${code}:${bookingId}:${now.toISOString().slice(0, 13)}`,
        details: {
          booking_id: bookingId,
          declared_bytes: declaredBytes,
          used_bytes: usage.usedBytes,
          limit_bytes: usage.limitBytes,
          daily_uploaded_bytes: usage.dailyUploadedBytes,
          daily_limit_bytes: usage.dailyLimitBytes,
        },
        occurredAt: now,
      }),
    );
    throw unavailable(
      code,
      full
        ? 'Storage is full — Clickco ops have been alerted; try again later'
        : 'Today’s upload capacity is nearly used — Clickco ops have been alerted; try again in a few hours',
    );
  }

  /** One StoragePort session per file, with RAW packed into ≤ 2 GiB part folders (ADR-0014 D1). */
  private async openStorageSessions(
    booking: UploadBookingFacts,
    files: readonly UploadFileDeclaration[],
  ): Promise<FilePlan[]> {
    const raws = files
      .filter((f) => f.kind === 'RAW_PHOTO')
      .sort((a, b) => a.name.localeCompare(b.name));
    const rawFolders = planRawFolders(
      await this.assets.rawFolderFills(this.sql, booking.bookingId),
      raws.map((f) => ({ id: f.clientFileId, sizeBytes: f.sizeBytes })),
    );
    const yearMonth = yearMonthIst(booking.scheduledStart);
    const opened: FilePlan[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const declaration = files[next++] as UploadFileDeclaration;
        const folder =
          declaration.kind === 'RAW_PHOTO'
            ? (rawFolders.get(declaration.clientFileId) as string)
            : folderFor(declaration.kind === 'VIDEO' ? 'VIDEO' : 'JPEG');
        const handle = await this.storage.createUploadSession({
          bookingId: booking.bookingId,
          bookingRef: booking.reference,
          yearMonth,
          relativePath: `${folder}/${declaration.name}`,
          fileName: declaration.name,
          sizeBytes: declaration.sizeBytes,
          contentType: contentTypeFor(declaration.name),
          kind: storageKindOf(declaration.kind),
          partSizeBytes: MEDIA_LIMITS.partSizeBytes,
        });
        opened.push({ declaration, folder, storageSessionId: handle.sessionId });
      }
    };
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(MEDIA_CONFIG.adapterSessionConcurrency, files.length) },
          worker,
        ),
      );
    } catch (error) {
      await this.abortStorageSessions(opened.map((p) => p.storageSessionId));
      throw toHttpError(error);
    }
    return opened;
  }

  private async abortStorageSessions(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      await this.storage
        .abortUpload(id)
        .catch((error: unknown) =>
          this.logger.warn(`Could not abort storage session ${id}: ${String(error)}`),
        );
    }
  }

  // ── resume ───────────────────────────────────────────────────────────────

  async view(photographerId: string, sessionId: string): Promise<UploadSessionView> {
    const session = await this.sessions.findForPhotographer(this.sql, sessionId, photographerId);
    if (!session) throw sessionNotFound();
    return toSessionView(session);
  }

  // ── complete ─────────────────────────────────────────────────────────────

  async complete(
    photographerId: string,
    sessionId: string,
  ): Promise<CompleteUploadSessionResponse> {
    const pre = await this.sessions.findForPhotographer(this.sql, sessionId, photographerId);
    if (!pre) throw sessionNotFound();
    const now = this.clock();
    const outcome = await this.sql.begin(async (tx) => {
      // Lock order booking → session, as every booking-changing path.
      const booking = await this.bookings.lock(tx, pre.bookingId);
      const s = await this.sessions.lockForPhotographer(tx, sessionId, photographerId);
      if (!s) return { kind: 'GONE' } as const;
      if (s.status === 'COMPLETED')
        return { kind: 'DONE', s, bookingStatus: booking.status } as const;
      if (!isOpen(s)) return { kind: 'CLOSED', status: s.status } as const;
      const unverified = unverifiedFiles(s.doc);
      if (unverified.length > 0) return { kind: 'INCOMPLETE', unverified } as const;

      const stored = await this.assets.unpurgedForSession(tx, s.id);
      const mismatch = reconcileSession(s, stored);
      if (mismatch) {
        await this.sessions.finish(tx, s.id, 'FAILED', `Reconciliation failed: ${mismatch}`, now);
        await appendMediaAlert(tx, {
          aggregateKind: 'booking',
          aggregateId: s.bookingId,
          severity: 'HIGH',
          sourceEventType: 'media.reconciliation_failed',
          dedupeKey: `reconcile:${s.id}`,
          details: { upload_session_id: s.id, reason: mismatch },
          occurredAt: now,
        });
        return { kind: 'FAILED', reason: mismatch } as const;
      }
      await this.sessions.finish(tx, s.id, 'COMPLETED', null, now);
      let bookingStatus = booking.status;
      if (booking.status === 'UPLOADING') {
        await this.bookings.transition(tx, {
          bookingId: s.bookingId,
          to: 'PROCESSING',
          actor: SYSTEM_ACTOR,
          occurredAt: now,
          reason: 'Upload verified complete',
          metadata: { upload_session_id: s.id },
          payload: {
            upload_session_id: s.id,
            file_count: s.receivedFileCount,
            bytes: s.receivedBytes,
            declared_frame_count: s.doc.declaredFrameCount,
          },
        });
        bookingStatus = 'PROCESSING';
      }
      return { kind: 'COMPLETED', s, bookingStatus } as const;
    });

    switch (outcome.kind) {
      case 'GONE':
        throw sessionNotFound();
      case 'CLOSED':
        throw conflict('UPLOAD_SESSION_CLOSED', 'This upload session is closed', {
          status: outcome.status,
        });
      case 'INCOMPLETE':
        throw conflict('UPLOAD_INCOMPLETE', 'Some files have not finished uploading', {
          missingCount: outcome.unverified.length,
          missing: outcome.unverified.slice(0, 50),
        });
      case 'FAILED':
        throw conflict(
          'RECONCILIATION_FAILED',
          'The upload could not be reconciled — Clickco ops have been alerted',
          { reason: outcome.reason },
        );
      default:
        return {
          sessionId: outcome.s.id,
          bookingId: outcome.s.bookingId,
          status: 'COMPLETED',
          bookingStatus: outcome.bookingStatus,
          receivedFileCount: outcome.s.receivedFileCount,
          receivedBytes: outcome.s.receivedBytes,
        };
    }
  }

  // ── abort ────────────────────────────────────────────────────────────────

  async abort(photographerId: string, sessionId: string): Promise<AbortUploadSessionResponse> {
    const now = this.clock();
    const outcome = await this.sql.begin(async (tx) => {
      const s = await this.sessions.lockForPhotographer(tx, sessionId, photographerId);
      if (!s) return { kind: 'GONE' } as const;
      if (s.status === 'ABORTED') return { kind: 'ABORTED', pending: [], objects: [] } as const;
      if (!isOpen(s)) return { kind: 'CLOSED', status: s.status } as const;
      const stored = await this.assets.unpurgedForSession(tx, s.id);
      await this.assets.markPurged(
        tx,
        stored.map((a) => a.id),
        now,
      );
      await this.sessions.finish(tx, s.id, 'ABORTED', 'Aborted by the photographer', now);
      const pending = Object.values(s.doc.files)
        .filter((f) => f.status === 'PENDING')
        .map((f) => f.storageSessionId);
      return { kind: 'ABORTED', pending, objects: stored.map((a) => a.storageObjectId) } as const;
    });
    if (outcome.kind === 'GONE') throw sessionNotFound();
    if (outcome.kind === 'CLOSED') {
      throw conflict('UPLOAD_SESSION_CLOSED', 'This upload session is closed', {
        status: outcome.status,
      });
    }
    await this.abortStorageSessions(outcome.pending);
    if (outcome.objects.length > 0) {
      // Permanent delete (Invariant 6). A failure leaves orphans the weekly audit reports.
      await this.storage
        .permanentlyDelete(outcome.objects)
        .catch((error: unknown) =>
          this.logger.error(
            `Aborted session ${sessionId}: could not delete stored files: ${String(error)}`,
          ),
        );
    }
    return { sessionId, status: 'ABORTED' };
  }
}
