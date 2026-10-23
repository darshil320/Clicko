import {
  type CompleteUploadFileResponse,
  fileExtension,
  type UploadPartResponse,
} from '@clickco/contracts';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import {
  ChecksumMismatchError,
  MissingPartsError,
  PartChecksumMismatchError,
  PartSizeMismatchError,
  StorageSessionNotFoundError,
} from '../../infra/storage/storage.errors';
import {
  type ByteSource,
  STORAGE_PORT,
  type StoragePort,
  type StoredObject,
} from '../../infra/storage/storage.port';
import { matchesFileSignature, readPrefix } from './file-signature';
import { badRequest, conflict, fileNotFound, sessionNotFound, unprocessable } from './http-errors';
import type { UploadSessionRecord } from './media.types';
import { MediaAssetsRepository } from './repositories/media-assets.repository';
import { UploadSessionsRepository } from './repositories/upload-sessions.repository';
import { expectedPartSize, missingParts, type SessionFileDoc } from './session-doc';
import { storageSessionInput, toHttpError } from './storage-files';
import { UploadBookings } from './upload-bookings';

export interface IncomingPart {
  readonly body: ByteSource;
  readonly contentLength: number;
  readonly sha256?: string;
  readonly md5Base64?: string;
  /** Reads and drops the rest of the body (a no-op re-put must still drain the socket). */
  discard(): Promise<void>;
}

const stateChanged = () =>
  conflict(
    'UPLOAD_STATE_CHANGED',
    'The upload changed while this request was in flight — fetch the session and continue',
  );

const sessionClosed = (status: string) =>
  conflict('UPLOAD_SESSION_CLOSED', 'This upload session is closed', { status });

/**
 * The byte path (ADR-0014 D2/D3): one part at a time, streamed into StoragePort and verified, then
 * a whole-file check when the browser says the file is done. No DB connection is held while bytes
 * move; every DB write re-checks the state it was decided on.
 */
@Injectable()
export class UploadPartsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(UploadBookings) private readonly bookings: UploadBookings,
    @Inject(UploadSessionsRepository) private readonly sessions: UploadSessionsRepository,
    @Inject(MediaAssetsRepository) private readonly assets: MediaAssetsRepository,
  ) {}

  private async openFile(photographerId: string, sessionId: string, fileId: string) {
    const session = await this.sessions.findForPhotographer(this.sql, sessionId, photographerId);
    if (!session) throw sessionNotFound();
    // Own keys only: an id like `constructor` must never resolve to a prototype member (L2).
    const file = Object.hasOwn(session.doc.files, fileId) ? session.doc.files[fileId] : undefined;
    if (!file) throw fileNotFound();
    return { session, file };
  }

  // ── parts ────────────────────────────────────────────────────────────────

  async putPart(
    photographerId: string,
    sessionId: string,
    fileId: string,
    partNumber: number,
    part: IncomingPart,
  ): Promise<UploadPartResponse> {
    const { session, file } = await this.openFile(photographerId, sessionId, fileId);
    if (session.status !== 'OPEN' && session.status !== 'UPLOADING')
      throw sessionClosed(session.status);
    if (file.status === 'VERIFIED') {
      throw conflict('FILE_ALREADY_VERIFIED', 'This file is already uploaded and verified');
    }
    if (partNumber > file.partCount) {
      throw badRequest('PART_OUT_OF_RANGE', `This file has ${file.partCount} parts`, {
        partCount: file.partCount,
      });
    }
    const expected = expectedPartSize(file, session.doc.partSizeBytes, partNumber);
    if (part.contentLength !== expected) {
      throw badRequest('PART_SIZE_MISMATCH', `Part ${partNumber} must be ${expected} bytes`, {
        expectedBytes: expected,
      });
    }
    if (part.sha256 !== undefined && file.parts[String(partNumber)] === part.sha256) {
      await part.discard();
      return { partNumber, sizeBytes: expected, sha256: part.sha256, alreadyStored: true };
    }

    let receipt: { sizeBytes: number; sha256: string };
    try {
      receipt = await this.storage.uploadPart(file.storageSessionId, partNumber, part.body, {
        sizeBytes: expected,
        ...(part.sha256 === undefined ? {} : { sha256: part.sha256 }),
        ...(part.md5Base64 === undefined ? {} : { md5Base64: part.md5Base64 }),
      });
    } catch (error) {
      if (error instanceof PartSizeMismatchError) {
        throw badRequest('PART_SIZE_MISMATCH', `Part ${partNumber} must be ${expected} bytes`, {
          expectedBytes: expected,
        });
      }
      if (error instanceof PartChecksumMismatchError) {
        throw unprocessable(
          'PART_CHECKSUM_MISMATCH',
          'The part did not arrive intact — send it again',
        );
      }
      if (error instanceof StorageSessionNotFoundError) throw stateChanged();
      throw toHttpError(error);
    }
    const recorded = await this.sessions.recordPart(this.sql, {
      sessionId,
      fileId,
      storageSessionId: file.storageSessionId,
      partNumber,
      sha256: receipt.sha256,
      now: this.clock(),
    });
    if (!recorded) throw stateChanged();
    return {
      partNumber,
      sizeBytes: receipt.sizeBytes,
      sha256: receipt.sha256,
      alreadyStored: false,
    };
  }

  // ── file complete ────────────────────────────────────────────────────────

  async completeFile(
    photographerId: string,
    sessionId: string,
    fileId: string,
    sha256: string,
  ): Promise<CompleteUploadFileResponse> {
    const { session, file } = await this.openFile(photographerId, sessionId, fileId);
    if (file.status === 'VERIFIED') return this.alreadyVerified(session, fileId, file, sha256);
    if (session.status !== 'OPEN' && session.status !== 'UPLOADING')
      throw sessionClosed(session.status);
    const missing = missingParts(file);
    if (missing.length > 0) {
      throw conflict('PARTS_MISSING', 'Some parts of this file have not arrived yet', {
        missingParts: missing.slice(0, 50),
      });
    }

    let stored: StoredObject;
    try {
      stored = await this.storage.completeUpload(file.storageSessionId, sha256);
    } catch (error) {
      const failure = await this.completionFailure(
        error,
        photographerId,
        session,
        fileId,
        file,
        sha256,
      );
      if (failure.kind === 'RESPONSE') return failure.response;
      throw failure.error;
    }

    await this.assertContentMatches(session, fileId, file, stored);
    try {
      return await this.commitVerified(photographerId, session, fileId, file, sha256, stored);
    } catch (error) {
      if (!(error instanceof HttpException)) {
        // The object exists but no row points at it: remove it rather than leave an orphan.
        await this.storage.permanentlyDelete([stored.objectId]).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * Security review M8: the stored bytes must look like the format the name claims before the
   * file is kept, delivered or exported. A mismatch drops the object and resets the file.
   */
  private async assertContentMatches(
    session: UploadSessionRecord,
    fileId: string,
    file: SessionFileDoc,
    stored: StoredObject,
  ): Promise<void> {
    let header: Buffer;
    try {
      header = await readPrefix(await this.storage.openObject(stored.objectId));
    } catch (error) {
      await this.storage.permanentlyDelete([stored.objectId]).catch(() => undefined);
      await this.restartFile(session, fileId, file);
      throw toHttpError(error);
    }
    if (matchesFileSignature(file.name, header)) return;
    await this.storage.permanentlyDelete([stored.objectId]);
    await this.restartFile(session, fileId, file);
    throw unprocessable(
      'FILE_CONTENT_MISMATCH',
      `${file.name} does not look like a ${fileExtension(file.name).slice(1).toUpperCase()} file — it may be renamed or damaged`,
      { clientFileId: fileId },
    );
  }

  private alreadyVerified(
    session: UploadSessionRecord,
    fileId: string,
    file: SessionFileDoc,
    sha256: string,
  ): CompleteUploadFileResponse {
    if (file.sha256 !== sha256 || !file.assetId) {
      throw conflict(
        'FILE_ALREADY_VERIFIED',
        'This file is already uploaded with a different checksum',
      );
    }
    return {
      clientFileId: fileId,
      status: 'VERIFIED',
      assetId: file.assetId,
      sizeBytes: file.sizeBytes,
      sha256,
      receivedFileCount: session.receivedFileCount,
      declaredFileCount: session.declaredFileCount,
    };
  }

  /** Maps a completeUpload failure to the HTTP answer, fixing the resume state first. */
  private async completionFailure(
    error: unknown,
    photographerId: string,
    session: UploadSessionRecord,
    fileId: string,
    file: SessionFileDoc,
    sha256: string,
  ): Promise<
    | { readonly kind: 'RESPONSE'; readonly response: CompleteUploadFileResponse }
    | { readonly kind: 'ERROR'; readonly error: unknown }
  > {
    if (error instanceof ChecksumMismatchError) {
      await this.restartFile(session, fileId, file);
      return {
        kind: 'ERROR',
        error: unprocessable(
          'CHECKSUM_MISMATCH',
          'The file did not arrive intact — it will be uploaded again from the start',
          { clientFileId: fileId },
        ),
      };
    }
    if (error instanceof MissingPartsError) {
      await this.sessions.forgetParts(this.sql, session.id, fileId, error.missingParts);
      return {
        kind: 'ERROR',
        error: conflict('PARTS_MISSING', 'Some parts of this file have not arrived yet', {
          missingParts: error.missingParts.slice(0, 50),
        }),
      };
    }
    if (error instanceof StorageSessionNotFoundError) {
      // A concurrent complete of the same file won the race.
      const fresh = await this.sessions.findForPhotographer(this.sql, session.id, photographerId);
      const f = fresh?.doc.files[fileId];
      if (fresh && f?.status === 'VERIFIED') {
        return { kind: 'RESPONSE', response: this.alreadyVerified(fresh, fileId, f, sha256) };
      }
      return { kind: 'ERROR', error: stateChanged() };
    }
    return { kind: 'ERROR', error: toHttpError(error) };
  }

  /** A checksum mismatch discarded the parts: open a new storage session, reset the file. */
  private async restartFile(session: UploadSessionRecord, fileId: string, file: SessionFileDoc) {
    const booking = await this.bookings.one(session.bookingId);
    if (!booking) return;
    const handle = await this.storage.createUploadSession(
      storageSessionInput(booking, file, session.doc.partSizeBytes),
    );
    const restarted = await this.sessions.restartFile(this.sql, {
      sessionId: session.id,
      fileId,
      oldStorageSessionId: file.storageSessionId,
      newStorageSessionId: handle.sessionId,
      now: this.clock(),
    });
    if (!restarted) await this.storage.abortUpload(handle.sessionId);
  }

  private async commitVerified(
    photographerId: string,
    session: UploadSessionRecord,
    fileId: string,
    file: SessionFileDoc,
    sha256: string,
    stored: StoredObject,
  ): Promise<CompleteUploadFileResponse> {
    const now = this.clock();
    const outcome = await this.sql.begin(async (tx) => {
      const locked = await this.sessions.lockForPhotographer(tx, session.id, photographerId);
      const current = locked?.doc.files[fileId];
      if (
        !locked ||
        !current ||
        (locked.status !== 'OPEN' && locked.status !== 'UPLOADING') ||
        current.status !== 'PENDING' ||
        current.storageSessionId !== file.storageSessionId
      ) {
        return { kind: 'STALE', locked, current } as const;
      }
      const assetId = await this.assets.insert(tx, {
        bookingId: locked.bookingId,
        uploadSessionId: locked.id,
        kind: current.kind,
        storageObjectId: stored.objectId,
        storagePath: stored.path,
        storageAdapter: this.storage.adapterId,
        originalFilename: current.name,
        mimeType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        checksumMd5: stored.md5,
        // SHA-256 verified against the browser's, MD5 recorded as the provider holds it.
        checksumVerifiedAt: now,
        derivedFromAssetId: null,
        widthPx: null,
        heightPx: null,
        createdAt: now,
      });
      await this.sessions.markFileVerified(tx, {
        sessionId: locked.id,
        fileId,
        sha256,
        assetId,
        sizeBytes: stored.sizeBytes,
        now,
      });
      return { kind: 'VERIFIED', assetId, locked } as const;
    });

    if (outcome.kind === 'STALE') {
      // Someone else's write won (a duplicate complete, an abort): this copy is surplus.
      await this.storage.permanentlyDelete([stored.objectId]);
      const { locked, current } = outcome;
      if (locked && current?.status === 'VERIFIED')
        return this.alreadyVerified(locked, fileId, current, sha256);
      if (locked && locked.status !== 'OPEN' && locked.status !== 'UPLOADING') {
        throw sessionClosed(locked.status);
      }
      throw stateChanged();
    }
    return {
      clientFileId: fileId,
      status: 'VERIFIED',
      assetId: outcome.assetId,
      sizeBytes: stored.sizeBytes,
      sha256,
      receivedFileCount: outcome.locked.receivedFileCount + 1,
      declaredFileCount: outcome.locked.declaredFileCount,
    };
  }
}
