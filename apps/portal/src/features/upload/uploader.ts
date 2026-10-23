import {
  type CompleteUploadFileResponse,
  type CompleteUploadSessionResponse,
  MEDIA_LIMITS,
  type UploadFileState,
  type UploadPartResponse,
  type UploadSessionView,
} from '@clickco/contracts';
import {
  type Checkpoint,
  type CheckpointStore,
  withFileRestarted,
  withFileVerified,
  withPartDone,
} from './checkpoints';
import type { CandidateFile } from './file-filter';
import {
  AbortedError,
  BACKOFF_SCHEDULE_MS,
  isRetryableStatus,
  type PartPlan,
  planParts,
  Semaphore,
  withRetry,
} from './plan';
import { etaSeconds, RateMeter } from './progress';
import { resumePlan } from './resume';

/**
 * The resumable multipart uploader (doc 02 §7, ADR-0014 D3/D6). Pure TypeScript: every side effect
 * (HTTP, IndexedDB, hashing, sleeping, time) is injected, so it is unit-tested without a browser.
 *
 *  - files are read in manifest order, part by part; each part is hashed (per-part SHA-256 for the
 *    server, and fed in order into the file's streaming SHA-256), then sent;
 *  - at most `concurrency` parts are being read or sent at once (4), across file boundaries;
 *  - a part the server already holds with the same hash is never re-sent (resume);
 *  - 5xx / 429 / network failures retry after 1, 2, 4, 8, 16 s, then the run stops with the error;
 *  - a whole-file checksum mismatch re-uploads that file once, then stops;
 *  - progress counts only acknowledged bytes.
 */

export interface SourceFile extends CandidateFile {
  read(start: number, end: number): Promise<Uint8Array>;
}

/** An API answer that was not a success, or a network failure (status 0). */
export class UploadHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'UploadHttpError';
  }
}

export interface UploadTransport {
  putPart(
    sessionId: string,
    clientFileId: string,
    partNumber: number,
    bytes: Uint8Array,
    sha256: string,
    signal: AbortSignal,
  ): Promise<UploadPartResponse>;
  completeFile(
    sessionId: string,
    clientFileId: string,
    sha256: string,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<CompleteUploadFileResponse>;
  completeSession(
    sessionId: string,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<CompleteUploadSessionResponse>;
}

export interface Hasher {
  update(bytes: Uint8Array): unknown;
  hex(): string;
}

export interface UploaderDeps {
  readonly transport: UploadTransport;
  readonly checkpoints: CheckpointStore;
  /** SHA-256 hex of one part (WebCrypto in the browser). */
  readonly digestPart: (bytes: Uint8Array) => Promise<string>;
  /** A streaming whole-file SHA-256 (sha256.ts). */
  readonly createHasher: () => Hasher;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly now: () => number;
  readonly newKey: () => string;
}

export interface UploaderOptions {
  readonly concurrency?: number;
  readonly schedule?: readonly number[];
}

export type UploadPhase = 'uploading' | 'finishing' | 'done' | 'paused' | 'failed';

export interface UploadProgress {
  readonly phase: UploadPhase;
  readonly bytesDone: number;
  readonly bytesAll: number;
  readonly filesDone: number;
  readonly filesAll: number;
  readonly bytesPerSecond: number | null;
  readonly etaSeconds: number | null;
  readonly activeFiles: readonly string[];
  readonly retrying: {
    readonly attempt: number;
    readonly delayMs: number;
    readonly message: string;
  } | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly result: CompleteUploadSessionResponse | null;
}

export interface UploadRunInput {
  readonly session: UploadSessionView;
  /** clientFileId → the local file (every unverified manifest file must be present). */
  readonly files: ReadonlyMap<string, SourceFile>;
  readonly checkpoint: Checkpoint;
}

const retryable = (error: unknown): boolean =>
  error instanceof UploadHttpError
    ? isRetryableStatus(error.status)
    : !(error instanceof AbortedError);

const describe = (error: unknown): { code: string; message: string } => {
  if (error instanceof UploadHttpError) return { code: error.code, message: error.message };
  if (error instanceof AbortedError) return { code: 'PAUSED', message: 'Upload paused' };
  return { code: 'UPLOAD_FAILED', message: error instanceof Error ? error.message : String(error) };
};

interface Dispatched {
  readonly puts: ReadonlyArray<Promise<void>>;
  readonly fileSha: string;
}

export class Uploader {
  private readonly controller = new AbortController();
  private readonly concurrency: number;
  private readonly schedule: readonly number[];
  private pausedByUser = false;

  constructor(
    private readonly deps: UploaderDeps,
    options: UploaderOptions = {},
  ) {
    this.concurrency = options.concurrency ?? MEDIA_LIMITS.concurrentParts;
    this.schedule = options.schedule ?? BACKOFF_SCHEDULE_MS;
  }

  /** Stops sending (in-flight requests are cancelled). The session stays resumable. */
  pause(): void {
    this.pausedByUser = true;
    this.controller.abort();
  }

  async run(
    input: UploadRunInput,
    onProgress: (p: UploadProgress) => void,
  ): Promise<UploadProgress> {
    const { session } = input;
    const signal = this.controller.signal;
    const plan = resumePlan(session);
    const meter = new RateMeter();
    const active = new Map<string, number>();
    let checkpoint = input.checkpoint;
    let fatal: unknown = null;
    let progress: UploadProgress = {
      phase: 'uploading',
      bytesDone: plan.verifiedBytes,
      bytesAll: session.files.reduce((sum, f) => sum + f.sizeBytes, 0),
      filesDone: plan.verifiedFiles,
      filesAll: session.files.length,
      bytesPerSecond: null,
      etaSeconds: null,
      activeFiles: [],
      retrying: null,
      error: null,
      result: null,
    };
    const emit = (change: Partial<UploadProgress>) => {
      const at = this.deps.now();
      const next = { ...progress, ...change };
      const rate = meter.bytesPerSecond(at);
      progress = {
        ...next,
        bytesPerSecond: rate,
        etaSeconds: etaSeconds(next.bytesAll - next.bytesDone, rate),
        activeFiles: [...active.keys()],
      };
      onProgress(progress);
    };
    const saveCheckpoint = (next: Checkpoint) => {
      checkpoint = next;
      void this.deps.checkpoints.save(next).catch(() => undefined);
    };
    const failFast = (error: unknown) => {
      if (fatal === null) fatal = error;
      this.controller.abort();
    };
    const retryOptions = (label: string) => ({
      schedule: this.schedule,
      isRetryable: retryable,
      sleep: this.deps.sleep,
      signal,
      onRetry: (attempt: number, delayMs: number, error: unknown) =>
        emit({ retrying: { attempt, delayMs, message: `${label}: ${describe(error).message}` } }),
    });
    const ack = (state: UploadFileState, part: PartPlan, sent: boolean) => {
      if (sent) meter.record(this.deps.now(), part.size);
      saveCheckpoint(
        withPartDone(checkpoint, state.clientFileId, part.partNumber, this.deps.now()),
      );
      emit({ bytesDone: progress.bytesDone + part.size, retrying: null });
    };
    const sem = new Semaphore(this.concurrency);

    const sendPart = async (
      state: UploadFileState,
      part: PartPlan,
      bytes: Uint8Array,
      sha: string,
    ) => {
      active.set(state.name, (active.get(state.name) ?? 0) + 1);
      try {
        await withRetry(
          () =>
            this.deps.transport.putPart(
              session.sessionId,
              state.clientFileId,
              part.partNumber,
              bytes,
              sha,
              signal,
            ),
          retryOptions(`${state.name} part ${part.partNumber}`),
        );
        ack(state, part, true);
      } finally {
        const left = (active.get(state.name) ?? 1) - 1;
        if (left > 0) active.set(state.name, left);
        else active.delete(state.name);
      }
    };

    const dispatch = async (
      state: UploadFileState,
      source: SourceFile,
      stored: ReadonlyMap<number, string>,
    ): Promise<Dispatched> => {
      const hasher = this.deps.createHasher();
      const puts: Array<Promise<void>> = [];
      for (const part of planParts(state.sizeBytes, session.partSizeBytes)) {
        if (signal.aborted) throw new AbortedError();
        const release = await sem.acquire();
        if (signal.aborted) {
          release();
          throw new AbortedError();
        }
        let bytes: Uint8Array;
        try {
          bytes = await source.read(part.start, part.end);
        } catch {
          release();
          throw new UploadHttpError(
            0,
            'FILE_UNREADABLE',
            `${state.name} could not be read — is the card still connected?`,
          );
        }
        if (bytes.length !== part.size) {
          release();
          throw new UploadHttpError(
            0,
            'FILE_CHANGED',
            `${state.name} changed on disk while uploading`,
          );
        }
        hasher.update(bytes);
        const sha = await this.deps.digestPart(bytes);
        if (stored.get(part.partNumber) === sha) {
          release();
          ack(state, part, false);
          continue;
        }
        const put = sendPart(state, part, bytes, sha).finally(release);
        put.catch(failFast);
        puts.push(put);
      }
      return { puts, fileSha: hasher.hex() };
    };

    const finalize = async (
      state: UploadFileState,
      source: SourceFile,
      sent: Dispatched,
      restarted: boolean,
    ) => {
      await Promise.all(sent.puts);
      const key = this.deps.newKey();
      try {
        await withRetry(
          () =>
            this.deps.transport.completeFile(
              session.sessionId,
              state.clientFileId,
              sent.fileSha,
              key,
              signal,
            ),
          retryOptions(`${state.name} verification`),
        );
      } catch (error) {
        if (
          !(error instanceof UploadHttpError) ||
          error.code !== 'CHECKSUM_MISMATCH' ||
          restarted
        ) {
          throw restarted && error instanceof UploadHttpError && error.code === 'CHECKSUM_MISMATCH'
            ? new UploadHttpError(
                422,
                'CHECKSUM_MISMATCH',
                `${state.name} failed verification twice — the card may be failing; copy it to the laptop and try again`,
              )
            : error;
        }
        // The server discarded the file's parts: send it again from the first byte, once.
        saveCheckpoint(withFileRestarted(checkpoint, state.clientFileId, this.deps.now()));
        emit({ bytesDone: progress.bytesDone - state.sizeBytes });
        const again = await dispatch(state, source, new Map());
        return finalize(state, source, again, true);
      }
      saveCheckpoint(withFileVerified(checkpoint, state.clientFileId, this.deps.now()));
      emit({ filesDone: progress.filesDone + 1 });
    };

    meter.record(this.deps.now(), 0);
    emit({});
    const finals: Array<Promise<void>> = [];
    for (const filePlan of plan.files) {
      if (filePlan.verified) continue;
      if (fatal !== null || signal.aborted) break;
      const state = session.files.find(
        (f) => f.clientFileId === filePlan.clientFileId,
      ) as UploadFileState;
      const source = input.files.get(filePlan.clientFileId);
      if (!source) {
        failFast(
          new UploadHttpError(
            0,
            'FILE_NOT_SELECTED',
            `${state.name} is not in the selected folder`,
          ),
        );
        break;
      }
      try {
        const sent = await dispatch(state, source, filePlan.stored);
        const done = finalize(state, source, sent, false);
        done.catch(failFast);
        finals.push(done);
      } catch (error) {
        failFast(error);
        break;
      }
    }
    await Promise.allSettled(finals);

    if (fatal !== null || signal.aborted) {
      const paused = this.pausedByUser || fatal instanceof AbortedError || fatal === null;
      emit(
        paused
          ? { phase: 'paused', retrying: null }
          : { phase: 'failed', retrying: null, error: describe(fatal) },
      );
      return progress;
    }

    emit({ phase: 'finishing', retrying: null });
    try {
      const key = this.deps.newKey();
      const result = await withRetry(
        () => this.deps.transport.completeSession(session.sessionId, key, signal),
        retryOptions('Finishing the upload'),
      );
      await this.deps.checkpoints.remove(session.sessionId).catch(() => undefined);
      emit({ phase: 'done', result, retrying: null });
    } catch (error) {
      emit(
        error instanceof AbortedError
          ? { phase: 'paused', retrying: null }
          : { phase: 'failed', retrying: null, error: describe(error) },
      );
    }
    return progress;
  }
}
