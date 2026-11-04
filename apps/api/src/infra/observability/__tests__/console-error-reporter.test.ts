import { describe, expect, it } from 'vitest';
import { ConsoleErrorReporter } from '../console-error-reporter';
import { toErrorEvent } from '../error-reporter';

describe('toErrorEvent', () => {
  it('is the scrubbed, JSON-safe shape every adapter sends', () => {
    const event = toErrorEvent({
      source: 'http',
      error: new TypeError('cannot read phone +919876543210'),
      context: { method: 'POST', route: '/bookings/:id/pay', email: 'a@b.co' },
    });
    expect(event).toMatchObject({
      source: 'http',
      name: 'TypeError',
      context: { method: 'POST', route: '/bookings/:id/pay', email: '[redacted]' },
    });
    expect(event.message).not.toContain('9876543210');
    expect(event.stack?.split('\n').length).toBeLessThanOrEqual(16);
  });

  it('accepts anything thrown, not only Errors', () => {
    expect(toErrorEvent({ source: 'job', error: 'boom 9876543210' })).toMatchObject({
      source: 'job',
      name: 'NonError',
      message: expect.not.stringContaining('9876543210'),
    });
    expect(toErrorEvent({ source: 'process', error: { weird: true } }).name).toBe('NonError');
  });
});

describe('ConsoleErrorReporter', () => {
  it('writes one JSON line per report, with nothing personal in it', () => {
    const lines: string[] = [];
    const reporter = new ConsoleErrorReporter((line) => lines.push(line));
    reporter.report({
      source: 'job',
      error: new Error('send to rohan@example.com failed'),
      context: { queue: 'notifications', job: 'notifications.send', phone: '+919876543210' },
    });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '{}');
    expect(parsed).toMatchObject({
      type: 'error_report',
      source: 'job',
      context: { queue: 'notifications', job: 'notifications.send', phone: '[redacted]' },
    });
    expect(lines[0]).not.toContain('rohan@example.com');
    expect(lines[0]).not.toContain('9876543210');
  });

  it('never throws, even when the sink does', () => {
    const reporter = new ConsoleErrorReporter(() => {
      throw new Error('stderr closed');
    });
    expect(() => reporter.report({ source: 'http', error: new Error('x') })).not.toThrow();
  });
});
