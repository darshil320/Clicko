import { isApiError } from '@clickco/api-client';
import type { ProAssignmentDetail } from '@clickco/contracts';
import { EmptyState, palette, Screen, Skeleton, Text } from '@clickco/ui';
import { useRouter } from 'expo-router';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import { useMemo } from 'react';
import { RefreshControl, View } from 'react-native';
import { userMessage } from '@/shared/errors';
import { useNow } from '@/shared/hooks/useNow';
import { useJob, useJobQueue } from '../hooks';
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

function JobError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const router = useRouter();
  if (isApiError(error) && error.code === 'ASSIGNMENT_NOT_FOUND') {
    return (
      <EmptyState
        icon={CircleAlert}
        title="This job isn't on your account"
        body="It may have been cancelled or passed to another photographer."
        action={{
          label: 'Back to jobs',
          onPress: () => (router.canGoBack() ? router.back() : router.replace('/')),
        }}
      />
    );
  }
  return (
    <EmptyState
      icon={CircleAlert}
      title="We couldn't load this job"
      body={userMessage(error)}
      action={{ label: 'Try again', onPress: onRetry }}
    />
  );
}

/**
 * The active-job screen (ADR-0024 D3, doc 01 screens 13–14): one screen whose content follows
 * the job from "on my way" to check-out, online or offline. Owns its own Screen.
 */
export function JobView({ assignmentId }: { assignmentId: string }) {
  const query = useJob(assignmentId);
  const refresh = () => void query.refetch();

  // Data first: an offline refetch failure must not replace a job the photographer is working.
  if (query.data) {
    return (
      <LoadedJob
        detail={query.data}
        refreshing={query.isRefetching}
        stale={query.isError}
        updatedAt={query.dataUpdatedAt}
        onRefresh={refresh}
      />
    );
  }
  return (
    <Screen topInset={false}>
      {query.isError ? <JobError error={query.error} onRetry={refresh} /> : <JobSkeleton />}
    </Screen>
  );
}
