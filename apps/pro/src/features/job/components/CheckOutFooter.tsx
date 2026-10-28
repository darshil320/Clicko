import { BottomSheet, Button, Input, Text } from '@clickco/ui';
import LogOut from 'lucide-react-native/icons/log-out';
import { useState } from 'react';
import { View } from 'react-native';
import { UPLOAD_WITHIN_HOURS } from '@/shared/catalogue';
import { useNow } from '@/shared/hooks/useNow';
import { useOnsiteFlow } from '../hooks';
import { checkOutBody, parseFrameCount } from '../lib/bodies';
import { formatClock, formatCountdown } from '../lib/timing';
import { FlowStatus } from './FlowStatus';

const COUNTDOWN_TICK_MS = 1000;

function CheckOutForm({ assignmentId, onDone }: { assignmentId: string; onDone: () => void }) {
  const flow = useOnsiteFlow(assignmentId);
  const [frames, setFrames] = useState('');
  const [framesError, setFramesError] = useState<string | undefined>();

  const submit = () =>
    flow.run(async () => {
      const tappedAt = new Date();
      const count = parseFrameCount(frames);
      if (count === null) {
        setFramesError('Enter the number of frames — a whole number, 0 or more.');
        return;
      }
      setFramesError(undefined);
      const fix = await flow.locate({ geofenced: true });
      if (!fix) return;
      const outcome = await flow.perform({
        kind: 'CHECK_OUT',
        body: checkOutBody(fix, count, tappedAt),
      });
      if (outcome) onDone();
    });

  return (
    <View className="gap-4">
      <Text tone="secondary">
        Checking out starts your {UPLOAD_WITHIN_HOURS}-hour upload window. A fresh GPS fix is taken
        at the venue.
      </Text>
      <Input
        label="Frames shot"
        value={frames}
        onChangeText={setFrames}
        keyboardType="number-pad"
        inputMode="numeric"
        error={framesError}
        hint="From your camera's frame counter."
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        testID="frame-count"
      />
      <FlowStatus flow={flow} />
      <Button
        label="Check out now"
        icon={LogOut}
        loading={flow.busy}
        onPress={() => void submit()}
        testID="confirm-check-out"
      />
    </View>
  );
}

export interface CheckOutFooterProps {
  readonly assignmentId: string;
  readonly earliestCheckOutAt: string | null;
}

/**
 * Shoot in progress (doc 01 screen 14): "Check out" stays disabled with a live countdown until
 * billing start + booked + approved extension hours (ADR-0013 D6), then asks for the frame count.
 */
export function CheckOutFooter({ assignmentId, earliestCheckOutAt }: CheckOutFooterProps) {
  const now = useNow(COUNTDOWN_TICK_MS);
  const [open, setOpen] = useState(false);
  const left = earliestCheckOutAt ? Date.parse(earliestCheckOutAt) - now.getTime() : 0;
  const locked = left > 0;

  return (
    <>
      <Text variant="caption" tone="secondary">
        {locked && earliestCheckOutAt
          ? `The booked time ends at ${formatClock(earliestCheckOutAt)}.`
          : "The booked time is over — check out when you've finished."}
      </Text>
      <Button
        label={locked ? `Check out in ${formatCountdown(left)}` : 'Check out'}
        icon={LogOut}
        disabled={locked}
        accessibilityLabel={
          locked && earliestCheckOutAt
            ? `Check out, available at ${formatClock(earliestCheckOutAt)}`
            : 'Check out'
        }
        onPress={() => setOpen(true)}
        testID="check-out"
      />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Check out">
        <CheckOutForm assignmentId={assignmentId} onDone={() => setOpen(false)} />
      </BottomSheet>
    </>
  );
}
