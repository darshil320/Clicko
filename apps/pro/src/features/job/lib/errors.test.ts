import { ApiError } from '@clickco/api-client';
import { describe, expect, it } from 'vitest';
import { describeRefusal, formatDistance, jobErrorMessage } from './errors';

const http = (status: number, code: string, message: string, details?: unknown) =>
  new ApiError({ kind: 'HTTP', status, code, message, details });

describe('formatDistance', () => {
  it('shows metres under a kilometre', () => {
    expect(formatDistance(239.6)).toBe('240 m');
  });

  it('shows kilometres from a kilometre up', () => {
    expect(formatDistance(2_430)).toBe('2.4 km');
  });
});

describe('describeRefusal — geofence and GPS (ADR-0013 D3, ADR-0015 M3)', () => {
  it('OUTSIDE_GEOFENCE uses the measured distance and the limit', () => {
    const refusal = {
      code: 'OUTSIDE_GEOFENCE',
      message: 'You are not at the venue yet',
      details: { distanceM: 240.2, limitM: 150 },
    };
    expect(describeRefusal(refusal, 'CHECK_IN')).toBe(
      "You're 240 m from the venue — check in within 150 m.",
    );
    expect(describeRefusal(refusal, 'CHECK_OUT')).toBe(
      "You're 240 m from the venue — check out within 150 m.",
    );
  });

  it('OUTSIDE_GEOFENCE without details falls back to the server message', () => {
    expect(
      describeRefusal(
        { code: 'OUTSIDE_GEOFENCE', message: 'You are not at the venue yet' },
        'CHECK_IN',
      ),
    ).toBe('You are not at the venue yet');
  });

  it('LOCATION_TOO_INACCURATE names the accuracy needed', () => {
    expect(
      describeRefusal(
        { code: 'LOCATION_TOO_INACCURATE', message: 'x', details: { maxAccuracyM: 100 } },
        'CHECK_IN',
      ),
    ).toBe(
      "Your GPS fix isn't precise enough — it needs to be ±100 m or better. Step outside or near a window and try again.",
    );
  });

  it('LOCATION_MOCKED tells the photographer what to switch off', () => {
    expect(describeRefusal({ code: 'LOCATION_MOCKED', message: 'x' }, 'CHECK_OUT')).toMatch(
      /mock location/,
    );
  });
});

describe('describeRefusal — timing', () => {
  it('TOO_EARLY on check-in says when it opens', () => {
    expect(
      describeRefusal(
        { code: 'TOO_EARLY', message: 'x', details: { opensAt: '2026-11-14T08:00:00.000Z' } },
        'CHECK_IN',
      ),
    ).toBe('This opens at 14 Nov, 1:30 pm — 3 hours before the shoot.');
  });

  it('TOO_EARLY on client-absent says when the 60 minutes are up', () => {
    expect(
      describeRefusal(
        { code: 'TOO_EARLY', message: 'x', details: { opensAt: '2026-11-14T12:00:00.000Z' } },
        'CLIENT_ABSENT',
      ),
    ).toBe('You can report the client absent from 5:30 pm — 60 minutes after the start.');
  });

  it('MINIMUM_DURATION_NOT_MET gives the earliest check-out', () => {
    expect(
      describeRefusal(
        {
          code: 'MINIMUM_DURATION_NOT_MET',
          message: 'The booked time is not over yet',
          details: { earliestCheckOutAt: '2026-11-14T13:00:00.000Z' },
        },
        'CHECK_OUT',
      ),
    ).toBe("The booked time isn't over yet — you can check out from 6:30 pm.");
  });

  it('WAITING_EXCEEDS_ELAPSED gives the most that can be logged', () => {
    expect(
      describeRefusal(
        { code: 'WAITING_EXCEEDS_ELAPSED', message: 'x', details: { elapsedMinutes: 35 } },
        'WAITING',
      ),
    ).toBe('Only 35 minutes have passed since the start — log 35 or fewer.');
  });

  it('EXTENSION_COOLDOWN says when to ask again', () => {
    expect(
      describeRefusal(
        {
          code: 'EXTENSION_COOLDOWN',
          message: 'x',
          details: { retryAt: '2026-11-14T12:50:00.000Z' },
        },
        'EXTENSION',
      ),
    ).toBe('The client just declined — you can ask again at 6:20 pm.');
  });
});

describe('describeRefusal — once-only and stage rules', () => {
  it.each([
    ['EXTENSION_PENDING', "The client hasn't answered your last extension request yet."],
    [
      'WAITING_ALREADY_LOGGED',
      'Waiting time is already logged for this shoot — it can be logged once.',
    ],
    ['CHECK_IN_ALREADY_RECORDED', "You're already checked in for this shoot."],
    ['CHECK_OUT_ALREADY_RECORDED', "You've already checked out of this shoot."],
    ['ASSIGNMENT_NOT_ACTIVE', 'This job is no longer active on your account.'],
  ])('%s', (code, sentence) => {
    expect(describeRefusal({ code, message: 'server words' }, 'START')).toBe(sentence);
  });

  it('an unknown code passes the server message through', () => {
    expect(describeRefusal({ code: 'SOMETHING_NEW', message: 'Server says no' }, 'START')).toBe(
      'Server says no',
    );
  });
});

describe('jobErrorMessage', () => {
  it('maps a 4xx ApiError through describeRefusal', () => {
    const error = http(422, 'OUTSIDE_GEOFENCE', 'x', { distanceM: 1_200, limitM: 150 });
    expect(jobErrorMessage(error, 'CHECK_IN')).toBe(
      "You're 1.2 km from the venue — check in within 150 m.",
    );
  });

  it('keeps the shared wording for server faults and anything else', () => {
    expect(jobErrorMessage(http(500, 'INTERNAL', 'boom'), 'CHECK_IN')).toBe(
      'Something went wrong on our side. Please try again in a moment.',
    );
    expect(jobErrorMessage(new Error('x'), 'CANCEL')).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
