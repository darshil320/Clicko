import { describe, expect, it } from 'vitest';
import { detailOf, eventOf } from './fixtures';
import { checklistFor, declineNote, listLabel, stageBadge, timelineEntries } from './labels';

describe('stageBadge', () => {
  it('names each stage plainly', () => {
    expect(stageBadge({ stage: 'EN_ROUTE', endReason: null, syncing: false })).toEqual({
      label: 'On the way',
      tone: 'neutral',
    });
    expect(stageBadge({ stage: 'IN_PROGRESS', endReason: null, syncing: false })).toEqual({
      label: 'Shooting',
      tone: 'success',
    });
  });

  it('says when the stage is still waiting to sync (ADR-0024 D5 wording)', () => {
    expect(stageBadge({ stage: 'CHECKED_IN', endReason: null, syncing: true })).toEqual({
      label: 'Checked in · waiting to sync',
      tone: 'warning',
    });
  });

  it('names the end reason of a terminal job', () => {
    expect(stageBadge({ stage: 'ENDED', endReason: 'UNSAFE_SITE', syncing: false })).toEqual({
      label: 'Unsafe site',
      tone: 'emergency',
    });
  });
});

describe('listLabel (Jobs tab cards)', () => {
  it('reads the assignment status', () => {
    expect(listLabel('ASSIGNED', [])).toBe('Booked');
    expect(listLabel('EN_ROUTE', [])).toBe('On the way');
    expect(listLabel('ACTIVE', [])).toBe('On site');
  });

  it('moves ahead with queued actions and says it is syncing', () => {
    expect(listLabel('ASSIGNED', ['CHECK_IN'])).toBe('On site · waiting to sync');
    expect(listLabel('ACTIVE', ['START'])).toBe('Shooting · waiting to sync');
  });
});

describe('checklistFor', () => {
  it('asks for dual cards and lighting on tiers that require them', () => {
    const labels = checklistFor('PROFESSIONAL').map((item) => item.label);
    expect(labels).toEqual([
      'Kit: Full-frame with lighting',
      'Batteries charged, spares packed',
      'Dual cards inserted, recording to both',
      'Lighting kit packed',
    ]);
  });

  it('keeps it to a formatted card on Basic', () => {
    const labels = checklistFor('BASIC').map((item) => item.label);
    expect(labels).toEqual([
      'Kit: APS-C or full-frame, 1 lens',
      'Batteries charged, spares packed',
      'Memory card formatted, with space',
    ]);
  });

  it('gives every item a stable key', () => {
    const keys = checklistFor('SIGNATURE').map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('declineNote', () => {
  it('explains the latest decline when nothing newer is pending', () => {
    const events = [
      eventOf('EXTENSION_REQUESTED', '2026-11-14T12:30:00.000Z'),
      eventOf('EXTENSION_DECLINED', '2026-11-14T12:40:00.000Z', { note: 'EXPIRED' }),
    ];
    expect(declineNote(events)).toBe(
      "Your last request lapsed — the client didn't answer in time.",
    );
  });

  it('is null when the latest extension event is not a decline', () => {
    const events = [
      eventOf('EXTENSION_DECLINED', '2026-11-14T12:10:00.000Z', { note: 'DECLINED_BY_CLIENT' }),
      eventOf('EXTENSION_REQUESTED', '2026-11-14T12:30:00.000Z'),
    ];
    expect(declineNote(events)).toBeNull();
  });

  it('falls back to a plain decline for an unknown reason', () => {
    const events = [eventOf('EXTENSION_DECLINED', '2026-11-14T12:40:00.000Z', { note: null })];
    expect(declineNote(events)).toBe('Your last request was declined.');
  });
});

describe('timelineEntries', () => {
  it('merges check-in, events and check-out in time order', () => {
    const entries = timelineEntries(
      detailOf({
        checkIn: { at: '2026-11-14T10:45:00.000Z', accuracyM: 9, offline: true, distanceM: 42 },
        checkOut: {
          at: '2026-11-14T13:10:00.000Z',
          accuracyM: 11,
          offline: false,
          declaredFrameCount: 410,
        },
        events: [
          eventOf('WAITING_LOGGED', '2026-11-14T11:30:00.000Z', { minutes: 20 }),
          eventOf('EXTENSION_APPROVED', '2026-11-14T12:50:00.000Z', { actorKind: 'USER' }),
        ],
      }),
    );
    expect(entries.map((e) => e.title)).toEqual([
      'Checked in',
      'Waiting logged',
      'Extension approved',
      'Checked out',
    ]);
    expect(entries[0]?.subtitle).toBe('42 m from the venue · sent later');
    expect(entries[1]?.subtitle).toBe('20 min');
    expect(entries[3]?.subtitle).toBe('410 frames');
  });

  it('keeps only the latest entries', () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      eventOf('EXTENSION_REQUESTED', new Date(Date.UTC(2026, 10, 14, 11, i)).toISOString()),
    );
    const entries = timelineEntries(detailOf({ events }));
    expect(entries).toHaveLength(8);
    expect(entries[7]?.at).toBe('2026-11-14T11:19:00.000Z');
  });
});
