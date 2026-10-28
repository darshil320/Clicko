import type { ProAssignment, ProUploadJob } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { dueUploads, soonestFirst, uploadDue } from './lists';

const assignment = (assignmentId: string, scheduledStart: string): ProAssignment => ({
  assignmentId,
  bookingId: `b-${assignmentId}`,
  bookingReference: `CK-${assignmentId}`,
  status: 'ASSIGNED',
  categoryCode: 'FOOD',
  tier: 'BASIC',
  scheduledStart,
  scheduledHours: 2,
  payoutPaise: 300_000,
  venue: {
    address: '1 MG Road',
    landmark: null,
    pincode: '395007',
    areaName: 'Athwa',
    cityName: 'Surat',
  },
  clientDisplayName: 'Rahul M.',
  specialRequirements: null,
  acceptedAt: '2026-11-10T09:00:00.000Z',
});

const upload = (
  bookingStatus: ProUploadJob['bookingStatus'],
  deadline: string | null,
): ProUploadJob => ({
  bookingId: `b-${bookingStatus}`,
  assignmentId: `a-${bookingStatus}`,
  bookingReference: `CK-${bookingStatus}`,
  bookingStatus,
  categoryCode: 'FOOD',
  tier: 'BASIC',
  scheduledStart: '2026-11-14T11:00:00.000Z',
  checkedOutAt: deadline ? '2026-11-14T13:00:00.000Z' : null,
  uploadDeadlineAt: deadline,
  activeSession: null,
  media: { rawFiles: 0, jpegFiles: 0, videoFiles: 0, exportedJpegs: 0, uploadedBytes: 0 },
});

describe('soonestFirst', () => {
  it('orders by scheduled start without touching the input', () => {
    const input = [
      assignment('b', '2026-11-15T05:00:00.000Z'),
      assignment('a', '2026-11-14T11:00:00.000Z'),
    ];
    expect(soonestFirst(input).map((a) => a.assignmentId)).toEqual(['a', 'b']);
    expect(input.map((a) => a.assignmentId)).toEqual(['b', 'a']);
  });
});

describe('dueUploads', () => {
  it('keeps shoots still waiting for their files, in the server order', () => {
    const jobs = [
      upload('CHECKED_OUT', '2026-11-14T19:00:00.000Z'),
      upload('UPLOADING', '2026-11-14T20:00:00.000Z'),
      upload('UNSAFE_SITE', null),
      upload('PROCESSING', '2026-11-14T18:00:00.000Z'),
      upload('QA', '2026-11-14T17:00:00.000Z'),
    ];
    expect(dueUploads(jobs).map((j) => j.bookingStatus)).toEqual([
      'CHECKED_OUT',
      'UPLOADING',
      'UNSAFE_SITE',
    ]);
  });
});

describe('uploadDue', () => {
  const now = new Date('2026-11-14T15:00:00.000Z');

  it('counts down to the deadline', () => {
    expect(uploadDue('2026-11-14T19:12:00.000Z', now)).toEqual({
      text: 'Due in 4h 12m',
      overdue: false,
    });
  });

  it('says how late an overdue upload is', () => {
    expect(uploadDue('2026-11-14T14:40:00.000Z', now)).toEqual({
      text: 'Overdue by 20m',
      overdue: true,
    });
  });

  it('asks for it soon when the deadline is unknown', () => {
    expect(uploadDue(null, now)).toEqual({ text: 'Upload as soon as you can', overdue: false });
  });
});
