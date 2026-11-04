import { Logger } from '@nestjs/common';
import { type ErrorReport, type ErrorReporter, toErrorEvent } from './error-reporter';

const logger = new Logger('ErrorReporter');

/**
 * The adapter until Sentry is approved (ADR-0029 D3): one scrubbed JSON line per report on the
 * Nest logger (stderr), context `ErrorReporter`, `"type":"error_report"`. Railway keeps the
 * logs; the runbook searches them for `error_report`.
 */
export class ConsoleErrorReporter implements ErrorReporter {
  constructor(private readonly write: (line: string) => void = (line) => logger.error(line)) {}

  report(report: ErrorReport): void {
    try {
      this.write(JSON.stringify({ type: 'error_report', ...toErrorEvent(report) }));
    } catch {
      // A reporter must never break the response or the job that called it.
    }
  }
}
