'use client';

import { newIdempotencyKey } from '@clickco/api-client';
import type {
  CompleteUploadSessionResponse,
  ProUploadJob,
  UploadFileState,
  UploadSessionView,
} from '@clickco/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../shared/api';
import { findUploadJob } from '../../shared/jobs-api';
import { browserCheckpointStore, type Checkpoint } from './checkpoints';
import { type AcceptedFile, detectFrames, filterFiles, type Rejection } from './file-filter';
import { abortableSleep } from './plan';
import { matchLocalFiles } from './resume';
import { Sha256, toHex } from './sha256';
import {
  abortUploadSession,
  createUploadSession,
  getUploadSession,
  httpUploadTransport,
} from './upload-api';
import { type SourceFile, Uploader, type UploaderDeps, type UploadProgress } from './uploader';

export type UploadStage =
  | { readonly kind: 'loading' }
  | { readonly kind: 'blocked'; readonly message: string; readonly showStatus: boolean }
  | {
      readonly kind: 'select';
      readonly accepted: ReadonlyArray<AcceptedFile<SourceFile>>;
      readonly rejected: readonly Rejection[];
      readonly detectedFrames: number;
    }
  | {
      readonly kind: 'resume';
      readonly session: UploadSessionView;
      readonly missing: readonly UploadFileState[];
      readonly rejected: readonly Rejection[];
    }
  | {
      readonly kind: 'running' | 'paused' | 'failed';
      readonly session: UploadSessionView;
      readonly progress: UploadProgress;
    }
  | { readonly kind: 'done'; readonly result: CompleteUploadSessionResponse };

async function digestPart(bytes: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)));
}

const checkpoints = browserCheckpointStore();

function uploaderDeps(): UploaderDeps {
  return {
    transport: httpUploadTransport,
    checkpoints,
    digestPart,
    createHasher: () => new Sha256(),
    sleep: abortableSleep,
    now: () => Date.now(),
    newKey: () => newIdempotencyKey(),
  };
}

function checkpointFor(session: UploadSessionView, photographerId: string): Checkpoint {
  const now = Date.now();
  return {
    sessionId: session.sessionId,
    bookingId: session.bookingId,
    photographerId,
    createdAt: now,
    updatedAt: now,
    files: session.files.map((f) => ({
      clientFileId: f.clientFileId,
      name: f.name,
      size: f.sizeBytes,
      lastModified: f.lastModified,
      kind: f.kind,
    })),
    doneParts: {},
    verifiedFiles: session.files.filter((f) => f.status === 'VERIFIED').map((f) => f.clientFileId),
  };
}

const EMPTY_SELECT: UploadStage = { kind: 'select', accepted: [], rejected: [], detectedFrames: 0 };

/** The upload page's state machine: select → (create session) → running ⇄ paused → done; or resume. */
export function useUpload(bookingId: string, photographerId: string | null) {
  const [job, setJob] = useState<ProUploadJob | null>(null);
  const [stage, setStage] = useState<UploadStage>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const uploader = useRef<Uploader | null>(null);
  const files = useRef<Map<string, SourceFile>>(new Map());
  const createKey = useRef<string>(newIdempotencyKey());

  const load = useCallback(async () => {
    setError(null);
    try {
      const found = await findUploadJob(bookingId);
      setJob(found);
      if (!found) {
        setStage({
          kind: 'blocked',
          message: 'This shoot is not waiting for an upload from you.',
          showStatus: false,
        });
        return;
      }
      if (found.bookingStatus !== 'CHECKED_OUT' && found.bookingStatus !== 'UPLOADING') {
        setStage({ kind: 'blocked', message: 'This shoot is already uploaded.', showStatus: true });
        return;
      }
      if (found.activeSession) {
        const session = await getUploadSession(found.activeSession.sessionId);
        setStage({ kind: 'resume', session, missing: [], rejected: [] });
        return;
      }
      setStage(EMPTY_SELECT);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [bookingId]);

  useEffect(() => {
    if (photographerId) void load();
  }, [load, photographerId]);

  const run = useCallback(
    async (session: UploadSessionView) => {
      if (!photographerId) return;
      const existing = await checkpoints.load(session.sessionId).catch(() => null);
      const checkpoint = existing ?? checkpointFor(session, photographerId);
      if (!existing) await checkpoints.save(checkpoint).catch(() => undefined);
      const u = new Uploader(uploaderDeps());
      uploader.current = u;
      const final = await u.run({ session, files: files.current, checkpoint }, (progress) =>
        setStage({ kind: 'running', session, progress }),
      );
      uploader.current = null;
      if (final.phase === 'done' && final.result) setStage({ kind: 'done', result: final.result });
      else
        setStage({
          kind: final.phase === 'paused' ? 'paused' : 'failed',
          session,
          progress: final,
        });
    },
    [photographerId],
  );

  /** Files dropped or picked: a new selection, or the same card again to resume. */
  const addFiles = useCallback(
    (incoming: readonly SourceFile[]) => {
      setError(null);
      if (stage.kind === 'select') {
        const pool = [...stage.accepted.map((a) => a.file), ...incoming];
        const { accepted, rejected } = filterFiles(pool, { videoEnabled: false });
        setStage({
          kind: 'select',
          accepted,
          rejected: [...stage.rejected, ...rejected],
          detectedFrames: detectFrames(accepted),
        });
        return;
      }
      if (stage.kind !== 'resume' && stage.kind !== 'paused' && stage.kind !== 'failed') return;
      const { accepted, rejected } = filterFiles(incoming, { videoEnabled: false });
      const match = matchLocalFiles(
        stage.session,
        accepted.map((a) => a.file),
      );
      for (const [id, f] of match.matched) files.current.set(id, f);
      const stillMissing = stage.session.files.filter(
        (f) => f.status !== 'VERIFIED' && !files.current.has(f.clientFileId),
      );
      if (stillMissing.length > 0) {
        setStage({ kind: 'resume', session: stage.session, missing: stillMissing, rejected });
        return;
      }
      // Every remaining file is matched: re-read the server's state (it is the truth) and go.
      void getUploadSession(stage.session.sessionId)
        .then(run)
        .catch((e: unknown) => setError(errorMessage(e)));
    },
    [run, stage],
  );

  const start = useCallback(
    async (declaredFrameCount: number) => {
      if (stage.kind !== 'select' || stage.accepted.length === 0) return;
      setError(null);
      const manifest = stage.accepted.map((a, i) => ({
        clientFileId: `f${i + 1}`,
        name: a.file.name,
        sizeBytes: a.file.size,
        kind: a.kind,
        lastModified: a.file.lastModified,
      }));
      try {
        const session = await createUploadSession(
          bookingId,
          { files: manifest, declaredFrameCount },
          createKey.current,
        );
        files.current = new Map(
          manifest.map((m, i) => [m.clientFileId, stage.accepted[i]?.file as SourceFile]),
        );
        await run(session);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [bookingId, run, stage],
  );

  const pause = useCallback(() => uploader.current?.pause(), []);

  const resume = useCallback(async () => {
    if (stage.kind !== 'paused' && stage.kind !== 'failed') return;
    try {
      const fresh = await getUploadSession(stage.session.sessionId);
      const missing = fresh.files.filter(
        (f) => f.status !== 'VERIFIED' && !files.current.has(f.clientFileId),
      );
      if (missing.length > 0) {
        setStage({ kind: 'resume', session: fresh, missing, rejected: [] });
        return;
      }
      await run(fresh);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [run, stage]);

  /** Cancels the session on the server: files already uploaded in it are deleted. */
  const cancel = useCallback(async () => {
    const session = 'session' in stage ? stage.session : null;
    if (!session) return;
    uploader.current?.pause();
    try {
      await abortUploadSession(session.sessionId, newIdempotencyKey());
      await checkpoints.remove(session.sessionId).catch(() => undefined);
      files.current = new Map();
      createKey.current = newIdempotencyKey();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [load, stage]);

  const clearSelection = useCallback(() => setStage(EMPTY_SELECT), []);

  return {
    job,
    stage,
    error,
    addFiles,
    start,
    pause,
    resume,
    cancel,
    clearSelection,
    reload: load,
  };
}
