import type { ProAssignmentDetail } from '@clickco/contracts';
import { EmptyState, ErrorState, palette, Screen, Skeleton, Text } from '@clickco/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import SearchX from 'lucide-react-native/icons/search-x';
import { useEffect, useMemo } from 'react';
import { RefreshControl, View } from 'react-native';
import { useNow } from '@/shared/hooks/useNow';
import { type ScreenState, screenState } from '@/shared/screen-state';
import { jobKeys, useJob, useJobQueue } from '../hooks';
import { isJobGone } from '../lib/errors';
import { projectJob } from '../lib/project';
import { formatAt } from '../lib/timing';
import { StageBody, stageFooter } from './StageBody';
import { SyncNotice } from './SyncNotice';

/** Opens-at and the stage gates move on this beat; timers tick on their own. */
const SCREEN_TICK_MS = 10_000;

interface LoadedJobProps {
  readonly detail: ProAssignmentDetail;
  readonly refreshing: boolean;
  /** The last refresh failed (offline): the screen keeps what it last loaded. */
  readonly stale: boolean;
  readonly updatedAt: number;
  readonly onRefresh: () => void;
}

function LoadedJob({ detail, refreshing, stale, updatedAt, onRefresh }: LoadedJobProps) {
  const { pending, failed, dismiss } = useJobQueue(detail.assignmentId);
  const now = useNow(SCREEN_TICK_MS);
  const job = useMemo(() => projectJob(detail, pending, now), [detail, pending, now]);
  const stage = { detail, job, now };

  return (
    <Screen
      topInset={false}
      footer={stageFooter(stage)}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={palette.text.secondary}
        />
      }
      testID="job-screen"
    >
      {stale ? (
        <Text variant="caption" tone="tertiary" accessibilityLiveRegion="polite">
          Couldn't refresh — showing the job as of{' '}
          {formatAt(new Date(updatedAt).toISOString(), now)}.
        </Text>
      ) : null}
      <SyncNotice queued={job.queued} failed={failed} onDismiss={dismiss} />
      <StageBody {...stage} />
    </Screen>
  );
}

function JobSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-6 w-32 rounded-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </View>
  );
}

type JobFailure = Extract<ScreenState<ProAssignmentDetail>, { kind: 'offline' | 'error' }>;

/** The API no longer serves this job to the photographer (released, e.g. the client cancelled). */
function JobMissing() {
  const router = useRouter();
  return (
    <EmptyState
      icon={SearchX}
      title="This job isn't on your account"
      body="The client may have cancelled it, or it was passed to another photographer. You don't need to go to this shoot."
      action={{
        label: 'Back to jobs',
        onPress: () => (router.canGoBack() ? router.back() : router.replace('/')),
      }}
      testID="job-missing"
    />
  );
}

function JobError({ failure, onRetry }: { failure: JobFailure; onRetry: () => void }) {
  return (
    <ErrorState
      offline={failure.kind === 'offline'}
      title="We couldn't load this job"
      body={failure.message}
      retrying={failure.retrying}
      onRetry={onRetry}
    />
  );
}

/**
 * The active-job screen (ADR-0024 D3, doc 01 screens 13–14): one screen whose content follows
 * the job from "on my way" to check-out, online or offline. Owns its own Screen.
 */
export function JobView({ assignmentId }: { assignmentId: string }) {
  const query = useJob(assignmentId);
  const queryClient = useQueryClient();
  const refresh = () => void query.refetch();
  const state = screenState(query);
  const gone = isJobGone(query);

  // A job the server no longer serves is dropped from the Jobs tab now, not at its next poll.
  useEffect(() => {
    if (gone) void queryClient.invalidateQueries({ queryKey: jobKeys.active });
  }, [gone, queryClient]);

  // The server saying the job is gone outranks a copy loaded earlier (it would keep offering
  // on-site actions); otherwise data first: an offline refetch failure must not replace a job
  // the photographer is working.
  if (gone) {
    return (
      <Screen topInset={false}>
        <JobMissing />
      </Screen>
    );
  }
  if (state.kind === 'ready' || state.kind === 'empty') {
    return (
      <LoadedJob
        detail={state.data}
        refreshing={query.isRefetching}
        stale={state.stale !== null}
        updatedAt={query.dataUpdatedAt}
        onRefresh={refresh}
      />
    );
  }
  return (
    <Screen topInset={false}>
      {state.kind === 'loading' ? <JobSkeleton /> : <JobError failure={state} onRetry={refresh} />}
    </Screen>
  );
}
