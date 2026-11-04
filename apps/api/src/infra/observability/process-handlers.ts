import type { ErrorReporter } from './error-reporter';

interface ProcessLike {
  on(event: 'uncaughtExceptionMonitor', listener: (error: Error, origin: string) => void): unknown;
  off(event: 'uncaughtExceptionMonitor', listener: (error: Error, origin: string) => void): unknown;
}

const NON_ERROR_REJECTION = 'A promise was rejected with a non-Error value';

/**
 * A rejection with a non-Error reason reaches the monitor as ERR_UNHANDLED_REJECTION, whose
 * message is `util.inspect(reason)`: the whole object, outside key-based redaction. Report a
 * fixed message instead (security review, 4 Nov).
 */
function withoutInspectedReason(error: Error): Error {
  if ((error as { code?: unknown }).code !== 'ERR_UNHANDLED_REJECTION') return error;
  return Object.assign(new Error(NON_ERROR_REJECTION), { code: 'ERR_UNHANDLED_REJECTION' });
}

/**
 * ADR-0029 D3: a crash (an uncaught exception, or an unhandled rejection Node turns into one) is
 * reported before the process exits. Only the *monitor* event is used: it observes without
 * handling, so Node still exits and the platform restarts the service, exactly as before.
 * Returns a function that removes the listener.
 */
export function installProcessErrorReporting(
  reporter: ErrorReporter,
  proc: ProcessLike,
  name: 'api' | 'media-worker',
): () => void {
  const listener = (error: Error, origin: string) =>
    reporter.report({
      source: 'process',
      error: withoutInspectedReason(error),
      context: { process: name, origin },
    });
  proc.on('uncaughtExceptionMonitor', listener);
  return () => {
    proc.off('uncaughtExceptionMonitor', listener);
  };
}
