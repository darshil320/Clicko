import { describe, expect, it } from 'vitest';
import {
  interpretWaitlistResponse,
  normaliseIndianMobile,
  outcomeMessage,
  resolveWaitlist,
  validateWaitlist,
  waitlistEndpoint,
} from './waitlist';

const valid = {
  fullName: '  Ananya   Iyer ',
  phone: '98765 43210',
  pincode: '411001',
  intendedDate: '',
};

describe('waitlistEndpoint', () => {
  it('defaults to the local API and trims trailing slashes', () => {
    expect(waitlistEndpoint(undefined)).toBe('http://localhost:4000/waitlist');
    expect(waitlistEndpoint('https://api.clickco.in/')).toBe('https://api.clickco.in/waitlist');
    expect(waitlistEndpoint('  ')).toBe('http://localhost:4000/waitlist');
  });
});

describe('resolveWaitlist (audit M1)', () => {
  const live = (endpoint: string) => ({ kind: 'live', endpoint });
  const api = 'https://api.clickco.in';

  it('uses the local API for a local build', () => {
    expect(resolveWaitlist({})).toEqual(live('http://localhost:4000/waitlist'));
    expect(resolveWaitlist({ NEXT_PUBLIC_API_URL: 'http://localhost:4100' })).toEqual(
      live('http://localhost:4100/waitlist'),
    );
  });

  it('never posts to localhost from a deployed site: no API URL means "opens soon"', () => {
    expect(resolveWaitlist({ VERCEL: '1', VERCEL_ENV: 'production' })).toEqual({
      kind: 'unavailable',
    });
    expect(resolveWaitlist({ VERCEL: '1', VERCEL_ENV: 'preview' })).toEqual({
      kind: 'unavailable',
    });
    expect(resolveWaitlist({ CLICKCO_DEPLOY: '1' })).toEqual({ kind: 'unavailable' });
  });

  it('fails a production build with a non-https API URL', () => {
    for (const env of [{ VERCEL: '1', VERCEL_ENV: 'production' }, { CLICKCO_DEPLOY: '1' }]) {
      expect(() => resolveWaitlist({ ...env, NEXT_PUBLIC_API_URL: 'http://api.x.in' })).toThrow(
        /https/,
      );
    }
  });

  it('switches the form off on a preview deploy with a non-https API URL', () => {
    expect(
      resolveWaitlist({ VERCEL: '1', VERCEL_ENV: 'preview', NEXT_PUBLIC_API_URL: 'http://x.in' }),
    ).toEqual({ kind: 'unavailable' });
  });

  it('posts to the configured https API in production', () => {
    expect(
      resolveWaitlist({ VERCEL: '1', VERCEL_ENV: 'production', NEXT_PUBLIC_API_URL: api }),
    ).toEqual(live('https://api.clickco.in/waitlist'));
  });

  it('build:production (LEGAL_STRICT=1) still requires the URL', () => {
    expect(() => resolveWaitlist({ LEGAL_STRICT: '1' })).toThrow(/must be set/);
    expect(() => resolveWaitlist({ LEGAL_STRICT: '1', NEXT_PUBLIC_API_URL: 'http://x' })).toThrow(
      /https/,
    );
    expect(resolveWaitlist({ LEGAL_STRICT: '1', NEXT_PUBLIC_API_URL: api }).kind).toBe('live');
  });

  it('rejects a malformed URL', () => {
    expect(() => resolveWaitlist({ NEXT_PUBLIC_API_URL: 'not a url' })).toThrow(/valid URL/);
  });
});

describe('normaliseIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['(+91) 6123 456 789', '+916123456789'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseIndianMobile(input)).toBe(expected);
  });

  it.each(['5876543210', '98765432', '+1 415 555 0100', 'abcdefghij', ''])(
    'rejects %s',
    (input) => {
      expect(normaliseIndianMobile(input)).toBeNull();
    },
  );
});

describe('validateWaitlist', () => {
  it('builds the JoinWaitlistBody shape the API expects', () => {
    expect(validateWaitlist(valid)).toEqual({
      ok: true,
      body: { phone: '+919876543210', fullName: 'Ananya Iyer', pincode: '411001' },
    });
  });

  it('includes the optional date only when given', () => {
    const result = validateWaitlist({ ...valid, intendedDate: '2027-01-14' });
    expect(result.ok && result.body.intendedDate).toBe('2027-01-14');
  });

  it('reports every invalid field at once', () => {
    const result = validateWaitlist({
      fullName: ' ',
      phone: '12345',
      pincode: '011001',
      intendedDate: '14/01',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      'fullName',
      'intendedDate',
      'phone',
      'pincode',
    ]);
  });

  it('rejects names longer than the contract allows', () => {
    const result = validateWaitlist({ ...valid, fullName: 'A'.repeat(121) });
    expect(result.ok).toBe(false);
  });
});

describe('interpretWaitlistResponse', () => {
  it('reads the waiting count from a success envelope', () => {
    const body = { success: true, data: { joined: true, waitingCount: 340 }, error: null };
    expect(interpretWaitlistResponse(200, body)).toEqual({ kind: 'joined', waitingCount: 340 });
  });

  it('treats a malformed success body as an error', () => {
    expect(interpretWaitlistResponse(200, { success: true, data: null })).toEqual({
      kind: 'error',
    });
  });

  it('maps 409 ALREADY_SERVICEABLE', () => {
    const body = {
      success: false,
      data: null,
      error: { code: 'ALREADY_SERVICEABLE', message: 'x' },
    };
    expect(interpretWaitlistResponse(409, body)).toEqual({ kind: 'already-serviceable' });
  });

  it('maps 429 RATE_LIMITED', () => {
    expect(interpretWaitlistResponse(429, null)).toEqual({ kind: 'rate-limited' });
  });

  it('maps 422 NOT_SERVICEABLE and passes through DATE_OUT_OF_RANGE wording', () => {
    expect(
      interpretWaitlistResponse(422, { error: { code: 'NOT_SERVICEABLE', message: 'no' } }),
    ).toEqual({ kind: 'not-serviceable' });
    const range = { error: { code: 'DATE_OUT_OF_RANGE', message: 'Pick a date between a and b' } };
    expect(interpretWaitlistResponse(422, range)).toEqual({
      kind: 'invalid',
      message: 'Pick a date between a and b',
    });
  });

  it('maps validation failures and server errors to friendly states', () => {
    expect(interpretWaitlistResponse(400, { error: { code: 'VALIDATION_FAILED' } }).kind).toBe(
      'invalid',
    );
    expect(interpretWaitlistResponse(500, { error: { code: 'INTERNAL' } })).toEqual({
      kind: 'error',
    });
    expect(interpretWaitlistResponse(502, 'Bad gateway')).toEqual({ kind: 'error' });
  });
});

describe('outcomeMessage', () => {
  it('celebrates a join with the waiting count', () => {
    const msg = outcomeMessage({ kind: 'joined', waitingCount: 340 }, '411001');
    expect(msg.tone).toBe('success');
    expect(msg.detail).toContain('340 people near 411001');
  });

  it('handles the first person on the list', () => {
    expect(outcomeMessage({ kind: 'joined', waitingCount: 1 }, '411001').detail).toContain(
      'You’re the first',
    );
  });

  it('turns already-serviceable into good news, not an error', () => {
    expect(outcomeMessage({ kind: 'already-serviceable' }, '395007').tone).toBe('info');
  });
});
