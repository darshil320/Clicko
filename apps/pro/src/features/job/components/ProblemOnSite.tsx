import { Card, ListRow, Section, Text } from '@clickco/ui';
import DoorClosed from 'lucide-react-native/icons/door-closed';
import ShieldAlert from 'lucide-react-native/icons/shield-alert';
import UserX from 'lucide-react-native/icons/user-x';
import { useState } from 'react';
import { SAFETY_LINE } from '../lib/labels';
import type { JobProjection } from '../lib/project';
import { formatAt } from '../lib/timing';
import { type IncidentKind, IncidentSheet } from './IncidentSheet';

const reported = (at: string | null, now: Date): string | null =>
  at ? `Reported at ${formatAt(at, now)} — ops has been alerted` : null;

export interface ProblemOnSiteProps {
  readonly assignmentId: string;
  readonly job: JobProjection;
  readonly now: Date;
}

/**
 * Access denied, unsafe site and client-absent (ADR-0013 D10/D12), plainly worded and always on
 * the screen from en-route until check-out. The API takes reports once checked in, so before that
 * the section says so and how to stay safe.
 */
export function ProblemOnSite({ assignmentId, job, now }: ProblemOnSiteProps) {
  const [kind, setKind] = useState<IncidentKind | null>(null);
  const onSite = job.stage === 'CHECKED_IN' || job.stage === 'IN_PROGRESS';
  const opensAt = job.timing.clientAbsentOpensAt;

  if (!onSite) {
    return (
      <Section title="Problem on site" subtitle={SAFETY_LINE}>
        <Card>
          <Text tone="secondary">
            Once you've checked in, report being refused entry, an unsafe site or a client who
            doesn't turn up — right here.
          </Text>
        </Card>
      </Section>
    );
  }

  return (
    <Section title="Problem on site" subtitle={SAFETY_LINE}>
      <Card padding="list">
        <ListRow
          icon={DoorClosed}
          iconTone="danger"
          title="Access denied"
          subtitle={reported(job.accessDeniedAt, now) ?? "You're refused entry to the venue"}
          accessory="chevron"
          onPress={() => setKind('ACCESS_DENIED')}
          divider
          testID="report-access-denied"
        />
        <ListRow
          icon={ShieldAlert}
          iconTone="emergency"
          title="Unsafe site"
          subtitle={reported(job.unsafeAt, now) ?? "You don't feel safe here"}
          accessory="chevron"
          onPress={() => setKind('UNSAFE')}
          divider={job.stage === 'CHECKED_IN'}
          testID="report-unsafe"
        />
        {job.stage === 'CHECKED_IN' ? (
          <ListRow
            icon={UserX}
            iconTone="warning"
            title="Client not here"
            subtitle={
              opensAt
                ? `From ${formatAt(opensAt, now)} — 60 minutes after the start`
                : '60 minutes after the start'
            }
            accessory="chevron"
            onPress={() => setKind('CLIENT_ABSENT')}
            testID="report-client-absent"
          />
        ) : null}
      </Card>
      <IncidentSheet
        kind={kind}
        assignmentId={assignmentId}
        clientAbsentOpensAt={opensAt}
        now={now}
        onClose={() => setKind(null)}
      />
    </Section>
  );
}
