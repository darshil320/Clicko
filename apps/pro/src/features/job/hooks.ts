import { newIdempotencyKey } from '@clickco/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { currentFix, fixForReport } from '@/shared/location/current-fix';
import type { DeviceFix } from '@/shared/location/fix';
import type { OnsiteAction } from '@/shared/offline/queue';
import { useOnsiteQueue } from '@/shared/offline/store';
import { cancelJob, fetchActiveJobs, fetchJob, fetchUploadJobs, sendOnsite } from './api';
import { geofencedFixProblem } from './lib/bodies';
import { jobErrorMessage } from './lib/errors';
import { SAFETY_LINE } from './lib/labels';

const LIST_POLL_MS = 60_000;
const DETAIL_POLL_MS = 60_000;
/** While the client is deciding on an extension, look more often (ADR-0013 D8: 10 min expiry). */
const DECISION_POLL_MS = 15_000;
const LOCATION_UNAVAILABLE = 'Your location is not available right now. Try again in a moment.';

export const jobKeys = {
  all: ['job'] as const,
  active: ['job', 'active'] as const,
  uploads: ['job', 'uploads'] as const,
  detail: (assignmentId: string) => ['job', 'detail', assignmentId] as const,
};

/**
 * Job queries poll only while the screen showing them is focused (a screen under another in the
 * stack, or a tab in the background, stays mounted). Refocusing refetches a stale query anyway.
 * The app being backgrounded is handled by the root layout's focusManager.
 */
export function useActiveJobs() {
  const focused = useIsFocused();
  return useQuery({
    queryKey: jobKeys.active,
    queryFn: fetchActiveJobs,
    refetchInterval: focused ? LIST_POLL_MS : false,
  });
}

export function useUploadJobs() {
  const focused = useIsFocused();
  return useQuery({
    queryKey: jobKeys.uploads,
    queryFn: fetchUploadJobs,
    refetchInterval: focused ? LIST_POLL_MS : false,
  });
}

/**
 * The job, polled while its screen is focused: every 15 s while an extension awaits the client,
 * otherwise every 60 s.
 */
export function useJob(assignmentId: string) {
  const focused = useIsFocused();
  return useQuery({
    queryKey: jobKeys.detail(assignmentId),
    queryFn: () => fetchJob(assignmentId),
    refetchInterval: (query) => {
      if (!focused) return false;
      return query.state.data?.pendingExtension?.status === 'PENDING'
        ? DECISION_POLL_MS
        : DETAIL_POLL_MS;
    },
  });
}

/** This job's queued and refused on-site actions. Selects stable arrays, filters in a memo. */
export function useJobQueue(assignmentId: string) {
  const pending = useOnsiteQueue((s) => s.pending);
  const failed = useOnsiteQueue((s) => s.failed);
  const dismiss = useOnsiteQueue((s) => s.dismiss);
  return useMemo(
    () => ({
      pending: pending.filter((p) => p.assignmentId === assignmentId),
      failed: failed.filter((f) => f.assignmentId === assignmentId),
      dismiss,
    }),
    [pending, failed, dismiss, assignmentId],
  );
}

export type FlowPhase = 'idle' | 'locating' | 'sending';
export type FlowOutcome = 'SENT' | 'QUEUED';

export interface LocateOptions {
  /** Check-in, check-out, client-absent: a mocked or too-rough fix is not sent. */
  readonly geofenced: boolean;
  /** Incident reports: a failure also reminds the photographer how to get help. */
  readonly safety?: boolean;
}

export interface OnsiteFlow {
  readonly phase: FlowPhase;
  readonly busy: boolean;
  readonly fix: DeviceFix | null;
  readonly error: string | null;
  /** Runs one tap's work; a second tap while it runs is ignored. Ends idle. */
  run(task: () => Promise<void>): Promise<void>;
  locate(options: LocateOptions): Promise<DeviceFix | null>;
  perform(action: OnsiteAction): Promise<FlowOutcome | null>;
  fail(message: string): void;
}

/**
 * One on-site action at a time: take a fresh fix (shown with its accuracy), then send through
 * performOnsite. A refusal becomes one plain sentence; a QUEUED result needs nothing here — the
 * queue store moves the screen ahead through projectJob. Call locate/perform inside `run`, which
 * holds the busy state across both steps and drops double taps.
 */
export function useOnsiteFlow(assignmentId: string): OnsiteFlow {
  const [phase, setPhase] = useState<FlowPhase>('idle');
  const [fix, setFix] = useState<DeviceFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    try {
      await task();
    } finally {
      running.current = false;
      setPhase('idle');
    }
  }, []);

  const locate = useCallback(async ({ geofenced, safety = false }: LocateOptions) => {
    const withSafety = (message: string) => (safety ? `${message} ${SAFETY_LINE}` : message);
    setError(null);
    setPhase('locating');
    try {
      const result = safety ? await fixForReport() : await currentFix();
      if (!result.ok) {
        setError(withSafety(result.message));
        return null;
      }
      setFix(result.fix);
      const problem = geofenced ? geofencedFixProblem(result.fix) : null;
      if (problem) setError(problem);
      return problem ? null : result.fix;
    } catch {
      setError(withSafety(LOCATION_UNAVAILABLE));
      return null;
    }
  }, []);

  const perform = useCallback(
    async (action: OnsiteAction): Promise<FlowOutcome | null> => {
      setError(null);
      setPhase('sending');
      try {
        const outcome = await sendOnsite(assignmentId, action);
        return outcome.status;
      } catch (failure) {
        setError(jobErrorMessage(failure, action.kind));
        return null;
      }
    },
    [assignmentId],
  );

  return { phase, busy: phase !== 'idle', fix, error, run, locate, perform, fail: setError };
}

/**
 * Cancel before check-in. One Idempotency-Key per intent: a retry with the same reason replays
 * the same outcome; a different reason is a new intent (the API refuses a key reused with
 * another body).
 */
export function useCancelJob(assignmentId: string) {
  const queryClient = useQueryClient();
  const intent = useRef<{ readonly reason: string; readonly key: string } | null>(null);
  return useMutation({
    mutationFn: (reason: string) => {
      const trimmed = reason.trim();
      if (intent.current?.reason !== trimmed) {
        intent.current = { reason: trimmed, key: newIdempotencyKey() };
      }
      return cancelJob(assignmentId, trimmed, intent.current.key);
    },
    onSuccess: () => {
      intent.current = null;
      void queryClient.invalidateQueries({ queryKey: jobKeys.active });
    },
  });
}
