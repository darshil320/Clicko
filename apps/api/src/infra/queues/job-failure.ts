import type { ErrorReporter } from '../observability/error-reporter';
import { scrubText } from '../observability/pii-scrubber';
import type { QueueName } from './queue-names';

/** The parts of a BullMQ job a failure handler may read. Never `data`: it can hold a phone. */
export interface FailedJob {
  readonly id?: string | undefined;
  readonly name: string;
  /** Already counts the attempt that just failed (BullMQ increments before `failed` fires). */
  readonly attemptsMade: number;
  readonly opts: { readonly attempts?: number | undefined };
}

interface WarnLogger {
  warn(message: string): void;
  error(message: string): void;
}

/**
 * ADR-0029 D3: every failed attempt is logged (scrubbed); the LAST one — retries exhausted, or
 * an UnrecoverableError — is reported as a dead letter with queue, job name and attempt counts.
 */
export function handleJobFailure(
  reporter: ErrorReporter,
  logger: WarnLogger,
  queue: QueueName,
  job: FailedJob | undefined,
  error: Error,
): void {
  const maxAttempts = job?.opts.attempts ?? 1;
  const attemptsMade = job?.attemptsMade ?? 0;
  const final =
    job === undefined || attemptsMade >= maxAttempts || error.name === 'UnrecoverableError';
  logger.warn(
    `Job ${job?.name ?? '?'} (${job?.id ?? '?'}) on ${queue} failed (attempt ${attemptsMade}/${maxAttempts}${final ? ', final' : ''}): ${scrubText(error.message)}`,
  );
  if (!final) return;
  reporter.report({
    source: 'job',
    error,
    context: {
      queue,
      job: job?.name ?? 'unknown',
      jobId: job?.id ?? null,
      attemptsMade,
      maxAttempts,
    },
  });
}

/** The same error on the same queue is reported at most this often (each one is still logged). */
export const WORKER_ERROR_REPORT_INTERVAL_MS = 60_000;

/**
 * A worker-level error (Redis connection, a stalled-job check): logged every time, reported at
 * most once a minute per queue and message. A Redis outage makes every worker reconnect over and
 * over; one report per minute says the same thing without flooding Sentry (security review LOW).
 */
export function workerErrorHandler(
  reporter: ErrorReporter,
  logger: WarnLogger,
  now: () => number = Date.now,
): (queue: QueueName, error: Error) => void {
  let lastReported: ReadonlyMap<string, number> = new Map();
  return (queue, error) => {
    logger.error(`Worker ${queue}: ${scrubText(error.message)}`);
    const key = `${queue}|${error.message}`;
    const last = lastReported.get(key);
    const at = now();
    if (last !== undefined && at - last < WORKER_ERROR_REPORT_INTERVAL_MS) return;
    lastReported = new Map([...lastReported, [key, at]]);
    reporter.report({ source: 'job', error, context: { queue, worker: true } });
  };
}
