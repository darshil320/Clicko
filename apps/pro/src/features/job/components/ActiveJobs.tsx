import type { ProAssignment } from '@clickco/contracts';
import { Card, Section, Skeleton, StateView, StatusBadge, Text, TierBadge } from '@clickco/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { categoryLabel } from '@/shared/catalogue';
import { formatShootWindow } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';
import type { OnsiteActionKind } from '@/shared/offline/queue';
import { useOnsiteQueue } from '@/shared/offline/store';
import { screenState } from '@/shared/screen-state';
import { useActiveJobs } from '../hooks';
import { listLabel } from '../lib/labels';
import { soonestFirst } from '../lib/lists';

interface JobCardProps {
  readonly job: ProAssignment;
  readonly queued: readonly OnsiteActionKind[];
  readonly onOpen: () => void;
}

function JobCard({ job, queued, onOpen }: JobCardProps) {
  const label = listLabel(job.status, queued);
  const tone = queued.length > 0 ? 'warning' : job.status === 'ACTIVE' ? 'success' : 'neutral';
  const window = formatShootWindow(job.scheduledStart, job.scheduledHours);
  const area = [job.venue.areaName, job.venue.cityName].filter(Boolean).join(', ');
  const payout = rupees(job.payoutPaise);
  const title = `${categoryLabel(job.categoryCode)} · ${window}`;

  return (
    <Card
      onPress={onOpen}
      accessibilityLabel={`${label}. ${title}. ${area}. Payout ${payout}.`}
      accessibilityHint="Opens the job"
      className="gap-2"
      testID={`active-job-${job.assignmentId}`}
    >
      <View className="flex-row items-center justify-between gap-3">
        <StatusBadge label={label} tone={tone} />
        <Text variant="h3" tabular>
          {payout}
        </Text>
      </View>
      <Text variant="bodyStrong" tabular>
        {title}
      </Text>
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="caption" tone="secondary" className="flex-1">
          {area}
        </Text>
        <TierBadge tier={job.tier} />
      </View>
    </Card>
  );
}

/**
 * Jobs tab: what you are booked for, soonest first. Nothing at all when there is nothing (the
 * offer feed below carries the empty state and its next step); a failed load says so and retries.
 */
export function ActiveJobs() {
  const router = useRouter();
  const query = useActiveJobs();
  const pending = useOnsiteQueue((s) => s.pending);
  const jobs = useMemo(() => (query.data ? soonestFirst(query.data) : []), [query.data]);

  const state = screenState(query);
  if (state.kind === 'empty') return null;

  return (
    <Section title="Your jobs">
      <StateView
        variant="card"
        state={state}
        loading={<Skeleton className="h-24 w-full rounded-lg" />}
        errorTitle="We couldn't load your jobs"
        onRetry={() => void query.refetch()}
      >
        {() =>
          jobs.map((job) => (
            <JobCard
              key={job.assignmentId}
              job={job}
              queued={pending
                .filter((p) => p.assignmentId === job.assignmentId)
                .map((p) => p.action.kind)}
              onOpen={() =>
                router.push({
                  pathname: '/jobs/[assignmentId]',
                  params: { assignmentId: job.assignmentId },
                })
              }
            />
          ))
        }
      </StateView>
    </Section>
  );
}
