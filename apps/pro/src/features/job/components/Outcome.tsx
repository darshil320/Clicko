import { Card, type CardTone, IconTile, type IconTileTone, ListRow, Text } from '@clickco/ui';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CircleX from 'lucide-react-native/icons/circle-x';
import MonitorUp from 'lucide-react-native/icons/monitor-up';
import ShieldAlert from 'lucide-react-native/icons/shield-alert';
import { View } from 'react-native';
import { UPLOAD_PORTAL_URL } from '@/shared/config';
import { formatDateTime } from '@/shared/format/datetime';
import type { EndReason, JobProjection } from '../lib/project';

const UPLOAD_LINE = `Upload from a computer at ${UPLOAD_PORTAL_URL}`;

/** After check-out: when, the frames declared, and the upload deadline (check-out + 6 h). */
export function DoneCard({ job }: { job: JobProjection }) {
  return (
    <Card className="gap-3" testID="job-done">
      <View className="flex-row items-center gap-3">
        <IconTile icon={CircleCheck} tone="success" />
        <Text variant="h2" accessibilityRole="header">
          {job.clientAbsent ? 'Shoot closed' : 'Shoot done'}
        </Text>
      </View>
      <View>
        {job.checkedOutAt ? (
          <ListRow title="Checked out" value={formatDateTime(job.checkedOutAt)} divider />
        ) : null}
        {job.declaredFrameCount !== null && !job.clientAbsent ? (
          <ListRow title="Frames declared" value={String(job.declaredFrameCount)} divider />
        ) : null}
        {job.timing.uploadDeadlineAt && !job.clientAbsent ? (
          <ListRow title="Upload by" value={formatDateTime(job.timing.uploadDeadlineAt)} emphasis />
        ) : null}
      </View>
      {job.clientAbsent ? (
        <Text tone="secondary">
          You reported the client absent. Clickco reviews the booking — there's nothing more to do
          on site.
        </Text>
      ) : (
        <ListRow
          icon={MonitorUp}
          title={UPLOAD_LINE}
          subtitle="RAW and JPEG files go through the upload portal, not this app."
        />
      )}
    </Card>
  );
}

interface EndCopy {
  readonly title: string;
  readonly body: string;
  readonly tone: CardTone;
  readonly tile: IconTileTone;
  readonly upload: boolean;
}

const END_COPY: Readonly<Record<EndReason, EndCopy>> = {
  ACCESS_DENIED: {
    title: 'Closed — access denied',
    body: "Clickco confirmed you couldn't get in. There's nothing more to do for this job.",
    tone: 'warning',
    tile: 'warning',
    upload: false,
  },
  UNSAFE_SITE: {
    title: 'Closed — unsafe site',
    body: 'Clickco confirmed the site was unsafe. Upload anything you captured before you left.',
    tone: 'emergency',
    tile: 'emergency',
    upload: true,
  },
  CANCELLED_BY_CLIENT: {
    title: 'The client cancelled',
    body: "You don't need to go to this shoot.",
    tone: 'default',
    tile: 'neutral',
    upload: false,
  },
  RELEASED: {
    title: "This job isn't yours any more",
    body: 'It has gone back to Clickco to be reassigned.',
    tone: 'default',
    tile: 'neutral',
    upload: false,
  },
  NO_SHOW: {
    title: 'This job was reassigned',
    body: 'There was no check-in by the start, so Clickco passed it to another photographer.',
    tone: 'warning',
    tile: 'warning',
    upload: false,
  },
  CANCELLED: {
    title: 'This booking was cancelled',
    body: "You don't need to go to this shoot.",
    tone: 'default',
    tile: 'neutral',
    upload: false,
  },
};

/** A job that ended without a check-out: what happened, in plain words. */
export function EndedCard({ reason }: { reason: EndReason }) {
  const copy = END_COPY[reason];
  return (
    <Card tone={copy.tone} className="gap-3" testID="job-ended">
      <View className="flex-row items-center gap-3">
        <IconTile icon={reason === 'UNSAFE_SITE' ? ShieldAlert : CircleX} tone={copy.tile} />
        <Text variant="h2" accessibilityRole="header" className="flex-1">
          {copy.title}
        </Text>
      </View>
      <Text tone="secondary">{copy.body}</Text>
      {copy.upload ? <ListRow icon={MonitorUp} title={UPLOAD_LINE} /> : null}
    </Card>
  );
}
