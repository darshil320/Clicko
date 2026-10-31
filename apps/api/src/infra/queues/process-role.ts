import {
  QUEUE,
  QUEUE_OF,
  type QueueName,
  REPEATABLE_JOBS,
  type RepeatableJob,
} from './queue-names';

/**
 * Which process this is (audit H1). `api` is main.ts; `media-worker` is worker.ts, the separate,
 * hardened process that alone runs darktable on untrusted RAW files when MEDIA_WORKER_ISOLATED.
 */
export type ProcessRole = 'api' | 'media-worker';

/** Provided by worker.module.ts; absent in the API, which means `api`. */
export const PROCESS_ROLE = Symbol('PROCESS_ROLE');

/** The queues this process consumes. */
export function queuesFor(role: ProcessRole, mediaWorkerIsolated: boolean): QueueName[] {
  if (role === 'media-worker') return [QUEUE.MEDIA_EXPORT];
  const all = Object.values(QUEUE);
  return mediaWorkerIsolated ? all.filter((q) => q !== QUEUE.MEDIA_EXPORT) : all;
}

/** The repeatable jobs this process schedules: only those on a queue it consumes. */
export function repeatablesFor(role: ProcessRole, mediaWorkerIsolated: boolean): RepeatableJob[] {
  const mine = new Set(queuesFor(role, mediaWorkerIsolated));
  return role === 'media-worker' ? [] : REPEATABLE_JOBS.filter((r) => mine.has(QUEUE_OF[r.job]));
}
