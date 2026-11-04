import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ErrorReport } from '../error-reporter';
import { installProcessErrorReporting } from '../process-handlers';

describe('installProcessErrorReporting (ADR-0029 D3)', () => {
  it('reports a crash through the monitor event, which leaves Node to exit as it would', () => {
    const reports: ErrorReport[] = [];
    const proc = new EventEmitter();
    const uninstall = installProcessErrorReporting({ report: (r) => reports.push(r) }, proc, 'api');
    const error = new Error('boom');
    proc.emit('uncaughtExceptionMonitor', error, 'unhandledRejection');
    expect(reports).toEqual([
      { source: 'process', error, context: { process: 'api', origin: 'unhandledRejection' } },
    ]);
    // It must not swallow anything: no uncaughtException / unhandledRejection listener is added.
    expect(proc.listenerCount('uncaughtException')).toBe(0);
    expect(proc.listenerCount('unhandledRejection')).toBe(0);
    uninstall();
    expect(proc.listenerCount('uncaughtExceptionMonitor')).toBe(0);
  });

  it('a rejected non-Error is reported with a fixed message (Node inspects the reason into it)', () => {
    const reports: ErrorReport[] = [];
    const proc = new EventEmitter();
    installProcessErrorReporting({ report: (r) => reports.push(r) }, proc, 'api');
    const inspected = Object.assign(
      new Error(
        "This error originated … reason \"{ name: 'Rohan Shah', phone: '+919876543210' }\"",
      ),
      { code: 'ERR_UNHANDLED_REJECTION' },
    );
    proc.emit('uncaughtExceptionMonitor', inspected, 'unhandledRejection');
    const reported = reports[0]?.error as Error;
    expect(reported.message).toBe('A promise was rejected with a non-Error value');
    expect(reported.message).not.toContain('Rohan');
  });
});
