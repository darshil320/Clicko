import { scrubPii, scrubText } from './pii-scrubber';

/**
 * ADR-0029 D3: where unexpected failures go. A port with one method, so the console adapter
 * (today) and a Sentry adapter (once @sentry/node is approved) are interchangeable. Callers pass
 * the raw error and a small context; the adapter sends only `toErrorEvent`'s scrubbed shape.
 *
 * Reported: unhandled HTTP errors (AllExceptionsFilter), BullMQ jobs that failed for the last
 * time and worker errors (QueueWorkers), and process-level crashes (main.ts, worker.ts).
 * Not reported: 4xx answers and deliberate 503s — those are the API working as designed.
 */
export type ErrorSource = 'http' | 'job' | 'process';

export interface ErrorReport {
  readonly source: ErrorSource;
  readonly error: unknown;
  /**
   * Route pattern, queue and job names, attempt counts: flat values only. Never request bodies,
   * job data or objects (key-based redaction is the second line of defence, not the first).
   */
  readonly context?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ErrorReporter {
  /**
   * Must never throw: a broken reporter cannot be allowed to break a response or a job. A crash
   * report is made just before Node exits, so an adapter that sends over the network must send
   * crashes synchronously or through its SDK's own exit hook (Sentry's onUncaughtException).
   */
  report(report: ErrorReport): void;
}

export const ERROR_REPORTER = Symbol('ERROR_REPORTER');

/** What every adapter sends: scrubbed, bounded, JSON-safe. */
export interface ErrorEvent {
  readonly source: ErrorSource;
  readonly name: string;
  readonly message: string;
  readonly stack: string | null;
  readonly code: string | null;
  readonly context: Readonly<Record<string, unknown>>;
}

export function toErrorEvent(report: ErrorReport): ErrorEvent {
  const context = (scrubPii(report.context ?? {}) ?? {}) as Record<string, unknown>;
  const { error } = report;
  if (error instanceof Error) {
    const scrubbed = scrubPii(error) as { message: string; stack?: string; code?: unknown };
    return {
      source: report.source,
      name: error.name,
      message: scrubbed.message,
      stack: scrubbed.stack ?? null,
      code: typeof scrubbed.code === 'string' ? scrubbed.code : null,
      context,
    };
  }
  const message = typeof error === 'string' ? scrubText(error) : JSON.stringify(scrubPii(error));
  return { source: report.source, name: 'NonError', message, stack: null, code: null, context };
}
