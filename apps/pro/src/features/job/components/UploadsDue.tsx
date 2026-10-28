import type { ProUploadJob } from '@clickco/contracts';
import { Button, Card, Section, StatusBadge, Text } from '@clickco/ui';
import { useMemo } from 'react';
import { View } from 'react-native';
import { categoryLabel } from '@/shared/catalogue';
import { UPLOAD_PORTAL_URL } from '@/shared/config';
import { userMessage } from '@/shared/errors';
import { formatDateTime } from '@/shared/format/datetime';
import { useNow } from '@/shared/hooks/useNow';
import { useUploadJobs } from '../hooks';
import { dueUploads, uploadDue } from '../lib/lists';

const COUNTDOWN_TICK_MS = 30_000;

function UploadCard({ job, now }: { job: ProUploadJob; now: Date }) {
  const due = uploadDue(job.uploadDeadlineAt, now);
  const session = job.activeSession;
  return (
    <Card className="gap-2" testID={`upload-due-${job.bookingId}`}>
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="bodyStrong" className="flex-1">
          {categoryLabel(job.categoryCode)} · {job.bookingReference}
        </Text>
        <StatusBadge label={due.text} tone={due.overdue ? 'danger' : 'warning'} />
      </View>
      <Text variant="caption" tone="secondary" tabular>
        {job.checkedOutAt ? `Checked out ${formatDateTime(job.checkedOutAt)}` : 'Shoot ended'}
        {job.uploadDeadlineAt ? ` · upload by ${formatDateTime(job.uploadDeadlineAt)}` : ''}
      </Text>
      {session ? (
        <Text variant="caption" tone="tertiary" tabular>
          Upload under way · {session.receivedFileCount} of {session.declaredFileCount} files
          received
        </Text>
      ) : null}
    </Card>
  );
}

/** Jobs tab: shoots still waiting for their files, with a countdown to each deadline. */
export function UploadsDue() {
  const query = useUploadJobs();
  const now = useNow(COUNTDOWN_TICK_MS);
  const due = useMemo(() => (query.data ? dueUploads(query.data) : []), [query.data]);

  if (query.isError && !query.data) {
    return (
      <Section title="Uploads due">
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
  if (due.length === 0) return null;

  return (
    <Section title="Uploads due" subtitle={`Upload from a computer at ${UPLOAD_PORTAL_URL}`}>
      {due.map((job) => (
        <UploadCard key={job.bookingId} job={job} now={now} />
      ))}
    </Section>
  );
}
