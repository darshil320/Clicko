import {
  CheckInBody,
  CheckOutBody,
  ClientAbsentBody,
  IncidentBody,
  LogWaitingBody,
} from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  CANCEL_REASON_MAX,
  checkInBody,
  checkOutBody,
  clientAbsentBody,
  geofencedFixProblem,
  incidentBody,
  navigateUrl,
  noteError,
  parseFrameCount,
  parseWaitingMinutes,
  waitingBody,
} from './bodies';
import { FIX } from './fixtures';

const TAPPED = new Date('2026-11-14T10:48:30.000Z');

describe('geofencedFixProblem (the app only judges whether a fix is worth sending)', () => {
  it('accepts a good or fair fix', () => {
    expect(geofencedFixProblem(FIX)).toBeNull();
    expect(geofencedFixProblem({ ...FIX, accuracyM: 80 })).toBeNull();
  });

  it('refuses a fix rougher than the server accepts', () => {
    expect(geofencedFixProblem({ ...FIX, accuracyM: 140 })).toBe(
      "Your GPS fix isn't precise enough — it needs to be ±100 m or better. Step outside or near a window and try again.",
    );
  });

  it('refuses a mocked fix (ADR-0015 M3)', () => {
    expect(geofencedFixProblem({ ...FIX, mocked: true })).toMatch(/mock location/);
  });
});

describe('body builders', () => {
  it('check-in carries the fix, mocked flag and the tapped time, online', () => {
    const body = checkInBody(FIX, TAPPED);
    expect(body).toEqual({
      lat: FIX.lat,
      lng: FIX.lng,
      accuracyM: 12,
      mocked: false,
      deviceTs: '2026-11-14T10:48:30.000Z',
      offline: false,
    });
    expect(CheckInBody.safeParse(body).success).toBe(true);
  });

  it('check-out adds the frame count', () => {
    const body = checkOutBody(FIX, 412, TAPPED);
    expect(body.declaredFrameCount).toBe(412);
    expect(CheckOutBody.safeParse(body).success).toBe(true);
  });

  it('client-absent adds a trimmed note', () => {
    const body = clientAbsentBody(FIX, '  Nobody answered the door  ', TAPPED);
    expect(body.note).toBe('Nobody answered the door');
    expect(ClientAbsentBody.safeParse(body).success).toBe(true);
  });

  it('waiting sends minutes, note and the position', () => {
    const body = waitingBody(FIX, 25, 'Client was stuck in traffic', TAPPED);
    expect(body).toEqual({
      minutes: 25,
      note: 'Client was stuck in traffic',
      lat: FIX.lat,
      lng: FIX.lng,
      deviceTs: '2026-11-14T10:48:30.000Z',
    });
    expect(LogWaitingBody.safeParse(body).success).toBe(true);
  });

  it('an incident is never blocked: a poor or mocked fix is sent as it is', () => {
    const body = incidentBody({ ...FIX, accuracyM: 900, mocked: true }, 'Gate locked', TAPPED);
    expect(body.accuracyM).toBe(900);
    expect(IncidentBody.safeParse(body).success).toBe(true);
  });

  it('an incident drops an accuracy the contract cannot carry rather than fail', () => {
    const body = incidentBody({ ...FIX, accuracyM: 25_000 }, 'Gate locked', TAPPED);
    expect(body.accuracyM).toBeUndefined();
    expect(IncidentBody.safeParse(body).success).toBe(true);
  });
});

describe('parseFrameCount', () => {
  it.each([
    ['412', 412],
    [' 0 ', 0],
    ['100000', 100_000],
  ])('accepts %j', (text, value) => {
    expect(parseFrameCount(text)).toBe(value);
  });

  it.each(['', '-1', '4.5', '12a', '100001', '1e3'])('refuses %j', (text) => {
    expect(parseFrameCount(text)).toBeNull();
  });
});

describe('parseWaitingMinutes', () => {
  it.each([
    ['25', 25],
    ['1', 1],
    ['240', 240],
  ])('accepts %j', (text, value) => {
    expect(parseWaitingMinutes(text)).toBe(value);
  });

  it.each(['', '0', '241', '2.5', 'ten'])('refuses %j', (text) => {
    expect(parseWaitingMinutes(text)).toBeNull();
  });
});

describe('noteError', () => {
  it('needs at least 3 characters after trimming', () => {
    expect(noteError('  ab ')).toBe('Add a few words — at least 3 characters.');
    expect(noteError('abc')).toBeNull();
  });

  it('caps the length (1000 by default)', () => {
    expect(noteError('x'.repeat(1000))).toBeNull();
    expect(noteError('x'.repeat(1001))).toBe('Keep it shorter — 1000 characters at most.');
  });

  it('takes a tighter cap for the cancel reason', () => {
    expect(noteError('x'.repeat(501), CANCEL_REASON_MAX)).toBe(
      'Keep it shorter — 500 characters at most.',
    );
  });
});

describe('navigateUrl', () => {
  it('builds a Google Maps directions link from the full address', () => {
    expect(
      navigateUrl({
        address: '12, Ghod Dod Road',
        landmark: 'Opp. Rajhans Cinema',
        pincode: '395007',
        areaName: 'Athwa',
        cityName: 'Surat',
      }),
    ).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=12%2C%20Ghod%20Dod%20Road%2C%20Athwa%2C%20Surat%20395007',
    );
  });

  it('is null once the address is hidden', () => {
    expect(
      navigateUrl({
        address: null,
        landmark: null,
        pincode: '395007',
        areaName: null,
        cityName: 'Surat',
      }),
    ).toBeNull();
  });
});
