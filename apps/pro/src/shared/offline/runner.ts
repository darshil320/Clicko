import { newIdempotencyKey } from '@clickco/api-client';
import { api } from '../api';
import { useSession } from '../session/store';
import {
  canSendAhead,
  classifyFailure,
  dueHeads,
  isOffline,
  keyForQueuedCopy,
  type OnsiteAction,
  pendingFor,
  type QueuedAction,
} from './queue';
import { useOnsiteQueue } from './store';

/** Upper bound on sends per flush, so a bug can never spin the radio. */
const MAX_SENDS_PER_FLUSH = 50;

/** Sends one on-site action. Every route is @Idempotent; the key is fixed per action. */
function send(
  assignmentId: string,
  action: OnsiteAction,
  idempotencyKey: string,
): Promise<unknown> {
  const key = { idempotencyKey };
  switch (action.kind) {
    case 'EN_ROUTE':
      return api.onsite.enRoute(assignmentId, key);
    case 'CHECK_IN':
      return api.onsite.checkIn(assignmentId, action.body, key);
    case 'START':
      return api.onsite.start(assignmentId, key);
    case 'EXTENSION':
      return api.onsite.requestExtension(assignmentId, action.deviceTs, key);
    case 'WAITING':
      return api.onsite.logWaiting(assignmentId, action.body, key);
    case 'ACCESS_DENIED':
      return api.onsite.reportAccessDenied(assignmentId, action.body, key);
    case 'UNSAFE':
      return api.onsite.reportUnsafe(assignmentId, action.body, key);
    case 'CLIENT_ABSENT':
      return api.onsite.reportClientAbsent(assignmentId, action.body, key);
    case 'CHECK_OUT':
      return api.onsite.checkOut(assignmentId, action.body, key);
  }
}

type SettledListener = (assignmentId: string) => void;
const listeners = new Set<SettledListener>();

/** Called after any on-site action reaches the server (sent now or flushed later). */
export function onOnsiteSettled(listener: SettledListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const notify = (assignmentId: string): void => {
  for (const listener of listeners) listener(assignmentId);
};

export type PerformResult<T> =
  | { readonly status: 'SENT'; readonly result: T }
  | { readonly status: 'QUEUED' };

function currentPhotographerId(): string {
  const id = useSession.getState().photographer?.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

function queue(
  photographerId: string,
  assignmentId: string,
  action: OnsiteAction,
  idempotencyKey: string,
): void {
  useOnsiteQueue.getState().add({
    id: newIdempotencyKey(),
    photographerId,
    assignmentId,
    action,
    idempotencyKey,
  });
}

/**
 * Do an on-site action now, or queue it (ADR-0024 D5).
 * - Earlier actions for this job still queued → queue behind them (never overtake), except a
 *   safety report once the check-in has gone (canSendAhead).
 * - No answer at all → queue with `offline: true` (and a fresh key if that changed the body).
 * - The server answered with an error → throw it; the screen shows the message.
 * - The session changed while the request was out → drop it, never queue it for someone else.
 */
export async function performOnsite<T>(
  assignmentId: string,
  action: OnsiteAction,
): Promise<PerformResult<T>> {
  const photographerId = currentPhotographerId();
  const idempotencyKey = newIdempotencyKey();
  const queuedForJob = pendingFor(useOnsiteQueue.getState(), assignmentId);
  if (queuedForJob.length > 0 && !canSendAhead(action, queuedForJob)) {
    queue(photographerId, assignmentId, action, idempotencyKey);
    void flushQueue();
    return { status: 'QUEUED' };
  }
  try {
    const result = (await send(assignmentId, action, idempotencyKey)) as T;
    notify(assignmentId);
    return { status: 'SENT', result };
  } catch (error) {
    if (!isOffline(error)) throw error;
    if (useSession.getState().photographer?.id !== photographerId) throw error;
    const key = keyForQueuedCopy(action, idempotencyKey, newIdempotencyKey());
    queue(photographerId, assignmentId, action, key);
    return { status: 'QUEUED' };
  }
}

async function attempt(item: QueuedAction): Promise<boolean> {
  const store = useOnsiteQueue.getState();
  try {
    await send(item.assignmentId, item.action, item.idempotencyKey);
    store.settle(item.id, { type: 'DONE' });
    notify(item.assignmentId);
    return true;
  } catch (error) {
    const outcome = classifyFailure(error);
    store.settle(item.id, outcome);
    if (outcome.type === 'REJECTED') notify(item.assignmentId);
    return false;
  }
}

let flushing: Promise<void> | null = null;

/** Send every due action, oldest first per job. One flush at a time. */
export function flushQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const photographerId = useSession.getState().photographer?.id;
    if (!photographerId) return;
    useOnsiteQueue.getState().expireStale();
    for (let sends = 0; sends < MAX_SENDS_PER_FLUSH; ) {
      const heads = dueHeads(useOnsiteQueue.getState(), photographerId, new Date());
      if (heads.length === 0) return;
      const results = await Promise.all(heads.map(attempt));
      sends += heads.length;
      if (!results.some(Boolean)) return;
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
