import { MEDIA_LIMITS } from '@clickco/contracts';

/** One multipart part of a file: bytes [start, end). Parts are numbered from 1. */
export interface PartPlan {
  readonly partNumber: number;
  readonly start: number;
  readonly end: number;
  readonly size: number;
}

/** Every part is `partSize` bytes except the last, which carries the remainder (the server's rule). */
export function planParts(fileSize: number, partSize: number): PartPlan[] {
  if (!Number.isSafeInteger(fileSize) || fileSize < 1) throw new RangeError('fileSize must be ≥ 1');
  if (!Number.isSafeInteger(partSize) || partSize < 1) throw new RangeError('partSize must be ≥ 1');
  const parts: PartPlan[] = [];
  for (let start = 0, n = 1; start < fileSize; start += partSize, n++) {
    const end = Math.min(start + partSize, fileSize);
    parts.push({ partNumber: n, start, end, size: end - start });
  }
  return parts;
}

/** doc 02 §7: 1, 2, 4, 8, 16 s, then the error is surfaced. */
export const BACKOFF_SCHEDULE_MS: readonly number[] = MEDIA_LIMITS.backoffScheduleMs;

/** A failure worth retrying: the network, a timeout, rate limiting, or the server's own fault. */
export interface RetryableFailure {
  readonly status: number;
}

export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export class AbortedError extends Error {
  constructor() {
    super('Upload paused');
    this.name = 'AbortedError';
  }
}

export interface RetryOptions {
  readonly schedule?: readonly number[];
  readonly isRetryable: (error: unknown) => boolean;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

/**
 * Runs `fn`; on a retryable failure waits the next delay in the schedule and tries again. After the
 * last delay the failure is rethrown for the UI. A non-retryable failure is rethrown at once.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const schedule = options.schedule ?? BACKOFF_SCHEDULE_MS;
  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw new AbortedError();
    try {
      return await fn();
    } catch (error) {
      if (options.signal?.aborted) throw new AbortedError();
      const delay = schedule[attempt];
      if (delay === undefined || !options.isRetryable(error)) throw error;
      options.onRetry?.(attempt + 1, delay, error);
      await options.sleep(delay, options.signal);
    }
  }
}

/** A sleep that rejects with AbortedError when the signal fires. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** At most `limit` holders at a time (doc 02 §7: 4 parts in flight). */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }

  get inFlight(): number {
    return this.active;
  }
}
