import type { ProAssignment } from '@clickco/contracts';
import { Button, Card, Section, Skeleton, StatusBadge, Text, TierBadge } from '@clickco/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { categoryLabel } from '@/shared/catalogue';
import { userMessage } from '@/shared/errors';
import { formatShootWindow } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';
import type { OnsiteActionKind } from '@/shared/offline/queue';
import { useOnsiteQueue } from '@/shared/offline/store';
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

/** Jobs tab: what you are booked for, soonest first. Nothing at all when there is nothing. */
export function ActiveJobs() {
  const router = useRouter();
  const query = useActiveJobs();
  const pending = useOnsiteQueue((s) => s.pending);
  const jobs = useMemo(() => (query.data ? soonestFirst(query.data) : []), [query.data]);

  if (query.isPending) {
    return (
      <Section title="Your jobs">
        <Skeleton className="h-24 w-full rounded-lg" />
      </Section>
    );
  }
  if (query.isError && !query.data) {
    return (
      <Section title="Your jobs">
        <Card className="gap-2">
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {userMessage(query.error)}
          </Text>
          <Button
            label="Try again"
            variant="ghost"
            size="compact"
            onPress={() => void query.refetch()}
          />
        </Card>
      </Section>
    );
  }
  if (jobs.length === 0) return null;

  return (
    <Section title="Your jobs">
      {jobs.map((job) => (
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
      ))}
    </Section>
  );
}
