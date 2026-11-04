import { describe, expect, it } from 'vitest';
import type { ErrorReport, ErrorReporter } from '../../observability/error-reporter';
import { handleJobFailure, workerErrorHandler } from '../job-failure';

function recording() {
  const reports: ErrorReport[] = [];
  const warnings: string[] = [];
  const reporter: ErrorReporter = { report: (r) => reports.push(r) };
  const logger = { warn: (m: string) => warnings.push(m), error: (m: string) => warnings.push(m) };
  return { reports, warnings, reporter, logger };
}

const job = (attemptsMade: number, attempts: number | undefined, data: unknown = {}) => ({
  id: '42',
  name: 'notifications.send',
  attemptsMade,
  opts: attempts === undefined ? {} : { attempts },
  data,
});

describe('handleJobFailure (ADR-0029 D3)', () => {
  it('a failure that will be retried is logged, not reported', () => {
    const r = recording();
    handleJobFailure(r.reporter, r.logger, 'notifications', job(2, 6), new Error('provider 503'));
    expect(r.reports).toEqual([]);
    expect(r.warnings[0]).toContain('attempt 2/6');
  });

  it('the last attempt is reported as a dead letter with queue, job and attempts', () => {
    const r = recording();
    const error = new Error('provider 503');
    handleJobFailure(r.reporter, r.logger, 'notifications', job(6, 6), error);
    expect(r.reports).toEqual([
      {
        source: 'job',
        error,
        context: {
          queue: 'notifications',
          job: 'notifications.send',
          jobId: '42',
          attemptsMade: 6,
          maxAttempts: 6,
        },
      },
    ]);
  });

  it('an unrecoverable error is final on any attempt; a job without retries on the first', () => {
    const r = recording();
    const fatal = Object.assign(new Error('bad data'), { name: 'UnrecoverableError' });
    handleJobFailure(r.reporter, r.logger, 'media', job(1, 5), fatal);
    handleJobFailure(r.reporter, r.logger, 'media', job(1, undefined), new Error('x'));
    expect(r.reports).toHaveLength(2);
  });

  it('never reports or logs the job data (it can hold a phone number)', () => {
    const r = recording();
    const otpJob = job(5, 5, { phone: '+919876543210', code: '123456' });
    handleJobFailure(r.reporter, r.logger, 'auth', otpJob, new Error('SMS to 9876543210 failed'));
    const everything = JSON.stringify({ reports: r.reports.map((x) => x.context), w: r.warnings });
    expect(everything).not.toContain('9876543210');
    expect(everything).not.toContain('123456');
  });

  it('a failure BullMQ reports without its job is still reported', () => {
    const r = recording();
    handleJobFailure(r.reporter, r.logger, 'sla', undefined, new Error('lost lock'));
    expect(r.reports[0]?.context).toMatchObject({ queue: 'sla', job: 'unknown', jobId: null });
  });
});

describe('workerErrorHandler', () => {
  it('reports a worker (connection) error with its queue', () => {
    const r = recording();
    const error = new Error('ECONNREFUSED');
    workerErrorHandler(r.reporter, r.logger, () => 0)('outbox', error);
    expect(r.reports).toEqual([
      { source: 'job', error, context: { queue: 'outbox', worker: true } },
    ]);
  });

  it('reports the same error on the same queue at most once a minute (a Redis outage reconnects often)', () => {
    const r = recording();
    let now = 0;
    const handle = workerErrorHandler(r.reporter, r.logger, () => now);
    handle('outbox', new Error('ECONNREFUSED'));
    now = 30_000;
    handle('outbox', new Error('ECONNREFUSED'));
    handle('sla', new Error('ECONNREFUSED'));
    now = 61_000;
    handle('outbox', new Error('ECONNREFUSED'));
    expect(r.reports.map((x) => x.context?.queue)).toEqual(['outbox', 'sla', 'outbox']);
    expect(r.warnings).toHaveLength(4);
  });
});
