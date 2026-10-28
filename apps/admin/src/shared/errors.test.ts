import { ApiError } from '@clickco/api-client';
import { describe, expect, it } from 'vitest';
import { describeError, isRetryable, NO_ACCESS, SESSION_ENDED } from './errors';

const http = (status: number, message = 'Server says no') =>
  new ApiError({ kind: 'HTTP', status, code: 'X', message });

describe('describeError (ADR-0025 D6)', () => {
  it('sends a 401 back to sign-in', () => {
    expect(describeError(http(401))).toEqual({ message: SESSION_ENDED, signIn: true });
  });

  it('says a 403 is about access, not the server’s wording', () => {
    expect(describeError(http(403, 'Forbidden resource'))).toEqual({
      message: NO_ACCESS,
      signIn: false,
    });
  });

  it('passes the server’s message through otherwise', () => {
    expect(describeError(http(409, 'Already decided by Ananya Iyer')).message).toBe(
      'Already decided by Ananya Iyer',
    );
    expect(
      describeError(
        new ApiError({ kind: 'NETWORK', status: 0, code: 'NETWORK', message: 'Offline' }),
      ).message,
    ).toBe('Offline');
    expect(describeError('boom').message).toBe('Something went wrong');
  });

  it('retries only network failures and 5xx', () => {
    expect(isRetryable(http(503))).toBe(true);
    expect(isRetryable(http(409))).toBe(false);
    expect(isRetryable(new ApiError({ kind: 'NETWORK', status: 0, code: 'N', message: 'x' }))).toBe(
      true,
    );
    expect(isRetryable(new Error('x'))).toBe(false);
  });
});
