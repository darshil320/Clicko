import type { ArgumentsHost } from '@nestjs/common';
import {
  BadGatewayException,
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorReport } from '../../../infra/observability/error-reporter';
import { AllExceptionsFilter } from '../all-exceptions.filter';

interface FakeRequest {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly route?: { readonly path: string };
  readonly subject?: { readonly kind: string; readonly id: string };
}

function run(exception: unknown, req: FakeRequest = {}) {
  const reports: ErrorReport[] = [];
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter({ report: (r) => reports.push(r) }).catch(exception, host);
  return { ...sent, reports };
}

/** What body-parser throws (an http-errors HttpError). */
const parserError = (status: number, type: string) =>
  Object.assign(new Error(`body-parser ${type}`), {
    status,
    statusCode: status,
    expose: true,
    type,
  });

describe('AllExceptionsFilter', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('passes a coded HttpException through as the envelope', () => {
    expect(run(new ConflictException({ code: 'X', message: 'y' }))).toEqual({
      status: 409,
      body: { success: false, data: null, error: { code: 'X', message: 'y' } },
      reports: [],
    });
  });

  it('an oversized body is 413, malformed JSON is 400 — not 500 (found with security review L1)', () => {
    expect(run(parserError(413, 'entity.too.large'))).toEqual({
      reports: [],
      status: 413,
      body: {
        success: false,
        data: null,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large' },
      },
    });
    expect(run(parserError(400, 'entity.parse.failed')).status).toBe(400);
    expect(run(parserError(400, 'entity.parse.failed')).body).toMatchObject({
      error: { code: 'INVALID_JSON' },
    });
  });

  it('anything else is a 500 that reveals nothing', () => {
    const sent = run(new Error('db password is hunter2'));
    expect({ status: sent.status, body: sent.body }).toEqual({
      status: 500,
      body: {
        success: false,
        data: null,
        error: { code: 'INTERNAL', message: 'Something went wrong' },
      },
    });
    // A 5xx or unexposed error from a library is still internal.
    expect(run(Object.assign(new Error('x'), { status: 502, expose: false })).status).toBe(500);
  });

  describe('error reporting (ADR-0029 D3)', () => {
    it('an unhandled error is reported with the route pattern, never the URL', () => {
      const error = new Error('boom');
      const { reports } = run(error, {
        method: 'GET',
        originalUrl: '/d/Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFG',
        route: { path: '/d/:token' },
        subject: { kind: 'USER', id: '3f2b8a52-6c1e-4d7a-9b1f-0c8e2a4d5b6f' },
      });
      expect(reports).toEqual([
        {
          source: 'http',
          error,
          context: { method: 'GET', route: '/d/:token', status: 500, subjectKind: 'USER' },
        },
      ]);
      expect(JSON.stringify(reports[0]?.context)).not.toContain('Abcdefghij');
    });

    it('a request that matched no route is reported as unmatched', () => {
      const { reports } = run(new Error('x'), { method: 'POST' });
      expect(reports[0]?.context).toEqual({ method: 'POST', route: '(unmatched)', status: 500 });
    });

    it('client errors and deliberate 503s are answered, not reported', () => {
      expect(run(new ConflictException({ code: 'X', message: 'y' })).reports).toEqual([]);
      expect(run(parserError(413, 'entity.too.large')).reports).toEqual([]);
      expect(
        run(new ServiceUnavailableException({ code: 'BUSY', message: 'later' })).reports,
      ).toEqual([]);
    });

    it('a 5xx HttpException other than 503 is reported', () => {
      const error = new BadGatewayException({ code: 'GATEWAY', message: 'Razorpay is down' });
      const sent = run(error, { method: 'POST', route: { path: '/bookings/:id/pay' } });
      expect(sent.status).toBe(502);
      expect(sent.reports).toHaveLength(1);
      expect(sent.reports[0]?.context).toMatchObject({ route: '/bookings/:id/pay', status: 502 });
    });

    it('a reporter that throws never breaks the response', () => {
      const res = { status: () => res, json: () => res };
      const host = {
        switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
      } as unknown as ArgumentsHost;
      const filter = new AllExceptionsFilter({
        report: () => {
          throw new Error('reporter down');
        },
      });
      expect(() => filter.catch(new Error('x'), host)).not.toThrow();
    });
  });
});
