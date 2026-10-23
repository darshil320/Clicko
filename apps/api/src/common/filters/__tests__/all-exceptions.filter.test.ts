import type { ArgumentsHost } from '@nestjs/common';
import { ConflictException, Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from '../all-exceptions.filter';

function run(exception: unknown) {
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
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return sent;
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
    });
  });

  it('an oversized body is 413, malformed JSON is 400 — not 500 (found with security review L1)', () => {
    expect(run(parserError(413, 'entity.too.large'))).toEqual({
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
    expect(run(new Error('db password is hunter2'))).toEqual({
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
});
