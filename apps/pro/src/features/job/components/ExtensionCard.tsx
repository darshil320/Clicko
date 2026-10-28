import type { ProAssignmentDetail } from '@clickco/contracts';
import { Button, Card, ListRow, Section, Text } from '@clickco/ui';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import Clock from 'lucide-react-native/icons/clock';
import Hourglass from 'lucide-react-native/icons/hourglass';
import { formatHours } from '@/shared/format/datetime';
import { useNow } from '@/shared/hooks/useNow';
import { useOnsiteFlow } from '../hooks';
import { declineNote } from '../lib/labels';
import type { JobProjection } from '../lib/project';
import { formatClock } from '../lib/timing';
import { ErrorText } from './FlowStatus';

const EXPIRY_TICK_MS = 15_000;

export interface ExtensionCardProps {
  readonly detail: ProAssignmentDetail;
  readonly job: JobProjection;
}

/**
 * One-hour extensions (ADR-0013 D8): one open request at a time; the client answers in their app
 * and the screen polls every 15 s meanwhile. An approved hour moves the check-out later.
 */
export function ExtensionCard({ detail, job }: ExtensionCardProps) {
  const flow = useOnsiteFlow(detail.assignmentId);
  const now = useNow(EXPIRY_TICK_MS);
  const open = detail.pendingExtension?.status === 'PENDING' ? detail.pendingExtension : null;
  const live = open !== null && Date.parse(open.expiresAt) > now.getTime();
  const waitingForClient = live || job.extensionQueued;
  const note = waitingForClient ? null : declineNote(detail.events);

  const request = () => {
    if (waitingForClient) return;
    void flow.run(async () => {
      await flow.perform({ kind: 'EXTENSION', deviceTs: new Date().toISOString() });
    });
  };

  return (
    <Section title="Extension" subtitle="One hour at a time. The client approves it in their app.">
      <Card className="gap-3">
        {detail.approvedExtensionHours > 0 ? (
          <ListRow
            icon={CircleCheck}
            iconTone="success"
            title="Approved"
            subtitle="Your check-out moves later by the same time"
            value={`+${formatHours(detail.approvedExtensionHours)}`}
          />
        ) : null}
        {live && open ? (
          <ListRow
            icon={Hourglass}
            title="Waiting for the client"
            subtitle={`Lapses at ${formatClock(open.expiresAt)} if they don't answer`}
          />
        ) : null}
        {job.extensionQueued ? (
          <Text variant="caption" tone="secondary">
            Request saved on this phone — it sends when you're back online.
          </Text>
        ) : null}
        {note ? (
          <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
            {note}
          </Text>
        ) : null}
        <ErrorText message={flow.error} />
        <Button
          label="Request 1-hour extension"
          icon={Clock}
          variant="secondary"
          disabled={waitingForClient}
          loading={flow.busy}
          onPress={request}
          testID="request-extension"
        />
      </Card>
    </Section>
  );
}
