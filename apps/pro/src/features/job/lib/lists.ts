import type { BookingStatus, ProAssignment, ProUploadJob } from '@clickco/contracts';
import { formatElapsed } from './timing';

/** The two Jobs-tab sections: active jobs (soonest first) and uploads still due. */

export function soonestFirst(assignments: readonly ProAssignment[]): readonly ProAssignment[] {
  return [...assignments].sort(
    (a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart),
  );
}

/**
 * Shoots whose files have not all arrived: checked out, an unsafe site (files captured so far,
 * ADR-0013 D10) or an upload under way. Processing and QA are Clickco's work, not the
 * photographer's. The server already orders by deadline.
 */
const AWAITING_UPLOAD: ReadonlySet<BookingStatus> = new Set([
  'CHECKED_OUT',
  'UNSAFE_SITE',
  'UPLOADING',
]);

export function dueUploads(jobs: readonly ProUploadJob[]): readonly ProUploadJob[] {
  return jobs.filter((job) => AWAITING_UPLOAD.has(job.bookingStatus));
}

export interface UploadDue {
  readonly text: string;
  readonly overdue: boolean;
}

export function uploadDue(deadline: string | null, now: Date): UploadDue {
  if (!deadline) return { text: 'Upload as soon as you can', overdue: false };
  const left = Date.parse(deadline) - now.getTime();
  return left >= 0
    ? { text: `Due in ${formatElapsed(left)}`, overdue: false }
    : { text: `Overdue by ${formatElapsed(-left)}`, overdue: true };
}
