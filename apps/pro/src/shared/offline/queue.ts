import { isApiError } from '@clickco/api-client';
import type {
  CheckInBody,
  CheckOutBody,
  ClientAbsentBody,
  IncidentBody,
  LogWaitingBody,
} from '@clickco/contracts';

/**
 * The offline write-ahead queue for on-site actions (v0.2 G-19, ADR-0024 D5). Pure state
 * transitions only — persistence lives in store.ts and the network in runner.ts — so every rule
 * here is unit-tested. State is never mutated: each function returns a new QueueState.
 */

export type OnsiteAction =
  | { readonly kind: 'EN_ROUTE' }
  | { readonly kind: 'CHECK_IN'; readonly body: CheckInBody }
  | { readonly kind: 'START' }
  | { readonly kind: 'EXTENSION'; readonly deviceTs: string }
  | { readonly kind: 'WAITING'; readonly body: LogWaitingBody }
  | { readonly kind: 'ACCESS_DENIED'; readonly body: IncidentBody }
  | { readonly kind: 'UNSAFE'; readonly body: IncidentBody }
  | { readonly kind: 'CLIENT_ABSENT'; readonly body: ClientAbsentBody }
  | { readonly kind: 'CHECK_OUT'; readonly body: CheckOutBody };

export type OnsiteActionKind = OnsiteAction['kind'];

export interface QueuedAction {
  readonly id: string;
  readonly photographerId: string;
  readonly assignmentId: string;
  readonly action: OnsiteAction;
  /** One key for every attempt of this action (the API dedupes within 10 min; deviceTs after). */
  readonly idempotencyKey: string;
  readonly queuedAt: string;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly lastError: string | null;
}

export interface FailedAction extends QueuedAction {
  readonly code: string;
  readonly message: string;
  readonly failedAt: string;
}

export interface QueueState {
  readonly pending: readonly QueuedAction[];
  readonly failed: readonly FailedAction[];
}

export const EMPTY_QUEUE: QueueState = { pending: [], failed: [] };

const FIRST_RETRY_MS = 15_000;
const MAX_RETRY_MS = 5 * 60_000;

/** 15 s, 30 s, 1 min, 2 min, 4 min, then every 5 min. */
export function retryDelayMs(attempts: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_MS);
}

/**
 * A queued action is replayed later, so the server must know it happened offline: geofenced
 * bodies carry `offline: true`, which (with deviceTs) makes the device time authoritative
 * within the server's 6 h window (ADR-0013 D5).
 */
export function markOffline(action: OnsiteAction): OnsiteAction {
  switch (action.kind) {
    case 'CHECK_IN':
    case 'CHECK_OUT':
    case 'CLIENT_ABSENT':
      return { ...action, body: { ...action.body, offline: true } } as OnsiteAction;
    default:
      return action;
  }
}

export interface NewQueuedAction {
  readonly id: string;
  readonly photographerId: string;
  readonly assignmentId: string;
  readonly action: OnsiteAction;
  readonly idempotencyKey: string;
}

export function enqueue(state: QueueState, item: NewQueuedAction, now: Date): QueueState {
  const queued: QueuedAction = {
    ...item,
    action: markOffline(item.action),
    queuedAt: now.toISOString(),
    attempts: 0,
    nextAttemptAt: now.toISOString(),
    lastError: null,
  };
  return { ...state, pending: [...state.pending, queued] };
}

export const pendingFor = (state: QueueState, assignmentId: string): readonly QueuedAction[] =>
  state.pending.filter((item) => item.assignmentId === assignmentId);

/**
 * What to send now: the oldest pending action of each assignment, if its retry time has come.
 * Only the head of an assignment's line is eligible, so a later action never overtakes an
 * earlier one (a start never reaches the server before its check-in).
 */
export function dueHeads(
  state: QueueState,
  photographerId: string,
  now: Date,
): readonly QueuedAction[] {
  const seen = new Set<string>();
  const heads: QueuedAction[] = [];
  for (const item of state.pending) {
    if (item.photographerId !== photographerId || seen.has(item.assignmentId)) continue;
    seen.add(item.assignmentId);
    if (Date.parse(item.nextAttemptAt) <= now.getTime()) heads.push(item);
  }
  return heads;
}

export type AttemptOutcome =
  | { readonly type: 'DONE' }
  | { readonly type: 'RETRY'; readonly message: string }
  | { readonly type: 'REJECTED'; readonly code: string; readonly message: string };

/** Idempotency answers that mean "the first attempt is still being processed": try again. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set(['IDEMPOTENCY_REQUEST_IN_PROGRESS']);

/**
 * No answer, a rate limit or a server error: try again later. Any other 4xx is the server's
 * final word on this action (e.g. OUTSIDE_GEOFENCE, ASSIGNMENT_NOT_ACTIVE): stop and show it.
 */
export function classifyFailure(error: unknown): AttemptOutcome {
  if (!isApiError(error)) return { type: 'RETRY', message: 'Unexpected error' };
  if (error.kind !== 'HTTP') return { type: 'RETRY', message: error.message };
  if (error.status === 429 || error.status >= 500 || RETRYABLE_CODES.has(error.code)) {
    return { type: 'RETRY', message: error.message };
  }
  return { type: 'REJECTED', code: error.code, message: error.message };
}

/** True when nothing answered at all — the case in which a fresh action is queued, not shown. */
export const isOffline = (error: unknown): boolean => isApiError(error) && error.kind === 'NETWORK';

export function applyOutcome(
  state: QueueState,
  id: string,
  outcome: AttemptOutcome,
  now: Date,
): QueueState {
  const item = state.pending.find((p) => p.id === id);
  if (!item) return state;
  const rest = state.pending.filter((p) => p.id !== id);
  switch (outcome.type) {
    case 'DONE':
      return { ...state, pending: rest };
    case 'RETRY': {
      const attempts = item.attempts + 1;
      const retried: QueuedAction = {
        ...item,
        attempts,
        nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)).toISOString(),
        lastError: outcome.message,
      };
      return { ...state, pending: state.pending.map((p) => (p.id === id ? retried : p)) };
    }
    case 'REJECTED': {
      const failed: FailedAction = {
        ...item,
        attempts: item.attempts + 1,
        lastError: outcome.message,
        code: outcome.code,
        message: outcome.message,
        failedAt: now.toISOString(),
      };
      return { pending: rest, failed: [...state.failed, failed] };
    }
  }
}

/** Retry everything now (the photographer tapped "Sync now", or the app came to the foreground). */
export function retryNow(state: QueueState, now: Date): QueueState {
  const at = now.toISOString();
  return { ...state, pending: state.pending.map((p) => ({ ...p, nextAttemptAt: at })) };
}

export function dismissFailed(state: QueueState, id: string): QueueState {
  return { ...state, failed: state.failed.filter((f) => f.id !== id) };
}

/** Plain words for a queued action ("Check-in", "Waiting time"), for the sync banner and Profile. */
export const ACTION_LABEL: Readonly<Record<OnsiteActionKind, string>> = {
  EN_ROUTE: 'On my way',
  CHECK_IN: 'Check-in',
  START: 'Shoot started',
  EXTENSION: 'Extension request',
  WAITING: 'Waiting time',
  ACCESS_DENIED: 'Access-denied report',
  UNSAFE: 'Unsafe-site report',
  CLIENT_ABSENT: 'Client-absent report',
  CHECK_OUT: 'Check-out',
};
