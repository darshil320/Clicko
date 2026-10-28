import { Button } from '@clickco/ui';
import LocateFixed from 'lucide-react-native/icons/locate-fixed';
import Navigation from 'lucide-react-native/icons/navigation';
import { useState } from 'react';
import { useOnsiteFlow } from '../hooks';
import { checkInBody } from '../lib/bodies';
import type { JobTiming } from '../lib/project';
import { formatAt, GEOFENCE_RADIUS_M } from '../lib/timing';
import { FlowStatus } from './FlowStatus';

export interface ArrivalFooterProps {
  readonly assignmentId: string;
  readonly stage: 'ASSIGNED' | 'EN_ROUTE';
  readonly timing: JobTiming;
  readonly now: Date;
}

/**
 * Before arrival (doc 01 screen 13): "On my way", then "Check in". Both open 3 h before the start
 * (ADR-0013 D2). Check-in may skip en-route — the server walks it. The fix's accuracy is shown;
 * the 150 m decision is the server's (ADR-0024 D4).
 */
export function ArrivalFooter({ assignmentId, stage, timing, now }: ArrivalFooterProps) {
  const flow = useOnsiteFlow(assignmentId);
  const [acting, setActing] = useState<'EN_ROUTE' | 'CHECK_IN' | null>(null);
  const closed = !timing.isOpen;

  const onEnRoute = () =>
    flow.run(async () => {
      setActing('EN_ROUTE');
      await flow.perform({ kind: 'EN_ROUTE' });
    });

  const onCheckIn = () =>
    flow.run(async () => {
      const tappedAt = new Date();
      setActing('CHECK_IN');
      const fix = await flow.locate({ geofenced: true });
      if (fix) await flow.perform({ kind: 'CHECK_IN', body: checkInBody(fix, tappedAt) });
    });

  const hint = closed
    ? `Opens at ${formatAt(timing.opensAt, now)} — 3 hours before the shoot.`
    : `Check in at the venue, within ${GEOFENCE_RADIUS_M} m.`;

  return (
    <>
      <FlowStatus flow={flow} hint={hint} />
      {stage === 'ASSIGNED' ? (
        <Button
          label="On my way"
          icon={Navigation}
          disabled={closed || (flow.busy && acting !== 'EN_ROUTE')}
          loading={flow.busy && acting === 'EN_ROUTE'}
          onPress={() => void onEnRoute()}
          accessibilityHint="Tells Clickco and the client you are travelling to the shoot"
          testID="en-route"
        />
      ) : null}
      <Button
        label="Check in"
        icon={LocateFixed}
        variant={stage === 'ASSIGNED' ? 'secondary' : 'primary'}
        disabled={closed || (flow.busy && acting !== 'CHECK_IN')}
        loading={flow.busy && acting === 'CHECK_IN'}
        onPress={() => void onCheckIn()}
        accessibilityHint="Takes a GPS fix and checks you in at the venue"
        testID="check-in"
      />
    </>
  );
}
