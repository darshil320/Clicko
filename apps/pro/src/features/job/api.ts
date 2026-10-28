import { api } from '@/shared/api';
import type { OnsiteAction } from '@/shared/offline/queue';
import { performOnsite } from '@/shared/offline/runner';

/** Active assignments (ASSIGNED / EN_ROUTE / ACTIVE), with the venue address. */
export const fetchActiveJobs = () => api.assignments.list();

/** One assignment with check-in/out, billing clock and events (address hidden once completed). */
export const fetchJob = (assignmentId: string) => api.assignments.get(assignmentId);

/** Shoots waiting for their upload (done from a computer through the portal). */
export const fetchUploadJobs = () => api.uploadJobs();

/** Before check-in only; the booking goes back to dispatch (ADR-0011, ADR-0012 D7). */
export const cancelJob = (assignmentId: string, reason: string, idempotencyKey: string) =>
  api.assignments.cancel(assignmentId, reason, { idempotencyKey });

/** Every on-site action goes through the offline-aware runner (ADR-0024 D5) — never api.onsite. */
export const sendOnsite = (assignmentId: string, action: OnsiteAction) =>
  performOnsite<unknown>(assignmentId, action);
