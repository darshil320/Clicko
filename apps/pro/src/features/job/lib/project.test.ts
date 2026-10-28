import { describe, expect, it } from 'vitest';
import { detailOf, eventOf, FIX, JOB_ID, queuedOf, START } from './fixtures';
import { projectJob } from './project';

const BEFORE_OPEN = new Date('2026-11-14T07:00:00.000Z'); // 12:30 pm IST
const ON_SITE = new Date('2026-11-14T10:50:00.000Z'); // 4:20 pm IST
const checkInBody = { ...FIX, deviceTs: '2026-11-14T10:48:00.000Z', offline: true };

describe('projectJob — the server state', () => {
  it('maps a fresh assignment to ASSIGNED with nothing syncing', () => {
    const job = projectJob(detailOf(), [], ON_SITE);
    expect(job.stage).toBe('ASSIGNED');
    expect(job.syncing).toBe(false);
    expect(job.endReason).toBeNull();
    expect(job.canCancel).toBe(true);
  });

  it.each([
    ['EN_ROUTE', 'EN_ROUTE', 'EN_ROUTE'],
    ['CHECKED_IN', 'ACTIVE', 'CHECKED_IN'],
    ['IN_PROGRESS', 'ACTIVE', 'IN_PROGRESS'],
    ['CHECKED_OUT', 'COMPLETED', 'CHECKED_OUT'],
    ['UPLOADING', 'COMPLETED', 'CHECKED_OUT'],
    ['DELIVERED', 'COMPLETED', 'CHECKED_OUT'],
  ] as const)('booking %s / assignment %s → %s', (bookingStatus, status, stage) => {
    expect(projectJob(detailOf({ bookingStatus, status }), [], ON_SITE).stage).toBe(stage);
  });

  it.each([
    ['ACCESS_DENIED', 'COMPLETED', 'ACCESS_DENIED'],
    ['UNSAFE_SITE', 'COMPLETED', 'UNSAFE_SITE'],
    ['CANCELLED_CLIENT', 'RELEASED', 'CANCELLED_BY_CLIENT'],
    ['DISPATCHING', 'RELEASED', 'RELEASED'],
    ['DISPATCHING', 'ABANDONED', 'NO_SHOW'],
    ['CANCELLED_PRO', 'ASSIGNED', 'CANCELLED'],
  ] as const)('booking %s / assignment %s ends the job: %s', (bookingStatus, status, reason) => {
    const job = projectJob(detailOf({ bookingStatus, status }), [], ON_SITE);
    expect(job.stage).toBe('ENDED');
    expect(job.endReason).toBe(reason);
    expect(job.canCancel).toBe(false);
  });

  it('falls back to the assignment status for a booking status it does not expect', () => {
    const job = projectJob(
      detailOf({ bookingStatus: 'CONFIRMED', status: 'EN_ROUTE' }),
      [],
      ON_SITE,
    );
    expect(job.stage).toBe('EN_ROUTE');
  });

  it('uses the server check-in, billing start and earliest check-out', () => {
    const job = projectJob(
      detailOf({
        bookingStatus: 'IN_PROGRESS',
        status: 'ACTIVE',
        checkIn: { at: '2026-11-14T10:45:00.000Z', accuracyM: 9, offline: false, distanceM: 40 },
        billingStartsAt: START,
        earliestCheckOutAt: '2026-11-14T14:00:00.000Z',
      }),
      [],
      ON_SITE,
    );
    expect(job.checkedInAt).toBe('2026-11-14T10:45:00.000Z');
    expect(job.timing.billingStartsAt).toBe(START);
    expect(job.timing.earliestCheckOutAt).toBe('2026-11-14T14:00:00.000Z');
    expect(job.timing.canCheckOut).toBe(false);
  });
});

describe('projectJob — queued actions move the screen ahead (ADR-0024 D5)', () => {
  it('a queued en-route shows EN_ROUTE and syncing', () => {
    const job = projectJob(
      detailOf(),
      [queuedOf({ kind: 'EN_ROUTE' }, ON_SITE.toISOString())],
      ON_SITE,
    );
    expect(job.stage).toBe('EN_ROUTE');
    expect(job.syncing).toBe(true);
    expect(job.queued).toEqual(['EN_ROUTE']);
    expect(job.canCancel).toBe(false);
  });

  it('a queued check-in straight from ASSIGNED shows CHECKED_IN at the tapped time', () => {
    const job = projectJob(
      detailOf(),
      [queuedOf({ kind: 'CHECK_IN', body: checkInBody }, '2026-11-14T10:49:00.000Z')],
      ON_SITE,
    );
    expect(job.stage).toBe('CHECKED_IN');
    expect(job.checkedInAt).toBe('2026-11-14T10:48:00.000Z');
    // Early arrival: billing still starts at the scheduled start.
    expect(job.timing.billingStartsAt).toBe(START);
    expect(job.timing.earliestCheckOutAt).toBe('2026-11-14T13:00:00.000Z');
    expect(job.timing.clientAbsentOpensAt).toBe('2026-11-14T12:00:00.000Z');
  });

  it('check-in then start, both queued, shows IN_PROGRESS', () => {
    const job = projectJob(
      detailOf({ bookingStatus: 'EN_ROUTE', status: 'EN_ROUTE' }),
      [
        queuedOf({ kind: 'CHECK_IN', body: checkInBody }, '2026-11-14T10:49:00.000Z'),
        queuedOf({ kind: 'START' }, '2026-11-14T10:55:00.000Z'),
      ],
      ON_SITE,
    );
    expect(job.stage).toBe('IN_PROGRESS');
    expect(job.queued).toEqual(['CHECK_IN', 'START']);
  });

  it('a queued check-out shows CHECKED_OUT with the frames and the upload deadline', () => {
    const job = projectJob(
      detailOf({ bookingStatus: 'IN_PROGRESS', status: 'ACTIVE' }),
      [
        queuedOf(
          {
            kind: 'CHECK_OUT',
            body: { ...FIX, declaredFrameCount: 412, deviceTs: '2026-11-14T13:05:00.000Z' },
          },
          '2026-11-14T13:05:01.000Z',
        ),
      ],
      ON_SITE,
    );
    expect(job.stage).toBe('CHECKED_OUT');
    expect(job.checkedOutAt).toBe('2026-11-14T13:05:00.000Z');
    expect(job.declaredFrameCount).toBe(412);
    expect(job.timing.uploadDeadlineAt).toBe('2026-11-14T19:05:00.000Z');
    expect(job.clientAbsent).toBe(false);
  });

  it('a queued client-absent report ends the shoot as checked out', () => {
    const job = projectJob(
      detailOf({ bookingStatus: 'CHECKED_IN', status: 'ACTIVE' }),
      [
        queuedOf(
          {
            kind: 'CLIENT_ABSENT',
            body: { ...FIX, note: 'Nobody at the door', deviceTs: '2026-11-14T12:05:00.000Z' },
          },
          '2026-11-14T12:05:00.000Z',
        ),
      ],
      ON_SITE,
    );
    expect(job.stage).toBe('CHECKED_OUT');
    expect(job.clientAbsent).toBe(true);
    expect(job.declaredFrameCount).toBe(0);
  });

  it('never moves a job backwards for a stale queued action', () => {
    const job = projectJob(
      detailOf({ bookingStatus: 'IN_PROGRESS', status: 'ACTIVE' }),
      [queuedOf({ kind: 'EN_ROUTE' }, ON_SITE.toISOString())],
      ON_SITE,
    );
    expect(job.stage).toBe('IN_PROGRESS');
    expect(job.syncing).toBe(true);
  });

  it('never revives an ended job', () => {
    const job = projectJob(
      detailOf({ bookingStatus: 'UNSAFE_SITE', status: 'COMPLETED' }),
      [queuedOf({ kind: 'START' }, ON_SITE.toISOString())],
      ON_SITE,
    );
    expect(job.stage).toBe('ENDED');
  });

  it("ignores another job's queue", () => {
    const job = projectJob(
      detailOf(),
      [queuedOf({ kind: 'EN_ROUTE' }, ON_SITE.toISOString(), 'another-job')],
      ON_SITE,
    );
    expect(job.stage).toBe('ASSIGNED');
    expect(job.syncing).toBe(false);
  });
});

describe('projectJob — on-site facts', () => {
  const inProgress = detailOf({ bookingStatus: 'IN_PROGRESS', status: 'ACTIVE' });

  it('reads waiting and incident reports from the server events', () => {
    const job = projectJob(
      {
        ...inProgress,
        events: [
          eventOf('WAITING_LOGGED', '2026-11-14T11:40:00.000Z', { minutes: 25 }),
          eventOf('UNSAFE_REPORTED', '2026-11-14T11:50:00.000Z'),
        ],
      },
      [],
      ON_SITE,
    );
    expect(job.waiting).toEqual({ minutes: 25, at: '2026-11-14T11:40:00.000Z' });
    expect(job.unsafeAt).toBe('2026-11-14T11:50:00.000Z');
    expect(job.accessDeniedAt).toBeNull();
  });

  it('reads waiting, extension and reports from the queue', () => {
    const job = projectJob(
      inProgress,
      [
        queuedOf(
          {
            kind: 'WAITING',
            body: {
              minutes: 20,
              note: 'Client late',
              lat: 1,
              lng: 1,
              deviceTs: '2026-11-14T11:30:00.000Z',
            },
          },
          '2026-11-14T11:30:01.000Z',
        ),
        queuedOf(
          { kind: 'EXTENSION', deviceTs: '2026-11-14T12:40:00.000Z' },
          '2026-11-14T12:40:01.000Z',
        ),
        queuedOf(
          {
            kind: 'ACCESS_DENIED',
            body: { note: 'Gate locked', lat: 1, lng: 1, deviceTs: '2026-11-14T12:41:00.000Z' },
          },
          '2026-11-14T12:41:01.000Z',
        ),
      ],
      ON_SITE,
    );
    expect(job.waiting).toEqual({ minutes: 20, at: '2026-11-14T11:30:00.000Z' });
    expect(job.extensionQueued).toBe(true);
    expect(job.accessDeniedAt).toBe('2026-11-14T12:41:00.000Z');
  });

  it('reads a server client-absent report', () => {
    const job = projectJob(
      detailOf({
        bookingStatus: 'CHECKED_OUT',
        status: 'COMPLETED',
        checkOut: {
          at: '2026-11-14T12:10:00.000Z',
          accuracyM: 10,
          offline: false,
          declaredFrameCount: 0,
        },
        events: [eventOf('CLIENT_ABSENT_REPORTED', '2026-11-14T12:10:00.000Z')],
      }),
      [],
      ON_SITE,
    );
    expect(job.clientAbsent).toBe(true);
    expect(job.checkedOutAt).toBe('2026-11-14T12:10:00.000Z');
  });
});

describe('projectJob — timing', () => {
  it('is closed before scheduled start − 3 h and open after', () => {
    expect(projectJob(detailOf(), [], BEFORE_OPEN).timing.isOpen).toBe(false);
    expect(projectJob(detailOf(), [], ON_SITE).timing.isOpen).toBe(true);
    expect(projectJob(detailOf(), [], ON_SITE).timing.opensAt).toBe('2026-11-14T08:00:00.000Z');
  });

  it('computes the earliest check-out locally with approved extensions while offline', () => {
    const job = projectJob(
      detailOf({ approvedExtensionHours: 1 }),
      [
        queuedOf(
          { kind: 'CHECK_IN', body: { ...checkInBody, deviceTs: '2026-11-14T11:20:00.000Z' } },
          '2026-11-14T11:20:00.000Z',
        ),
      ],
      new Date('2026-11-14T14:30:00.000Z'),
    );
    // Late arrival: billed from 11:20 UTC, 2 h + 1 h → 14:20 UTC.
    expect(job.timing.billingStartsAt).toBe('2026-11-14T11:20:00.000Z');
    expect(job.timing.earliestCheckOutAt).toBe('2026-11-14T14:20:00.000Z');
    expect(job.timing.canCheckOut).toBe(true);
  });

  it('has no billing clock before a check-in', () => {
    const job = projectJob(detailOf({ assignmentId: JOB_ID }), [], ON_SITE);
    expect(job.timing.billingStartsAt).toBeNull();
    expect(job.timing.earliestCheckOutAt).toBeNull();
    expect(job.timing.canCheckOut).toBe(false);
    expect(job.timing.uploadDeadlineAt).toBeNull();
  });
});
