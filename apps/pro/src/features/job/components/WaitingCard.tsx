import { BottomSheet, Button, Card, Input, ListRow, Section, Text } from '@clickco/ui';
import Hourglass from 'lucide-react-native/icons/hourglass';
import { useState } from 'react';
import { View } from 'react-native';
import { useOnsiteFlow } from '../hooks';
import { noteError, parseWaitingMinutes, waitingBody } from '../lib/bodies';
import type { JobProjection } from '../lib/project';
import { formatClock } from '../lib/timing';
import { FlowStatus } from './FlowStatus';

interface FieldErrors {
  readonly minutes?: string;
  readonly note?: string;
}

function WaitingForm({ assignmentId, onDone }: { assignmentId: string; onDone: () => void }) {
  const flow = useOnsiteFlow(assignmentId);
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () =>
    flow.run(async () => {
      const tappedAt = new Date();
      const parsed = parseWaitingMinutes(minutes);
      const next: FieldErrors = {
        minutes: parsed === null ? 'Enter the minutes — a whole number from 1 to 240.' : undefined,
        note: noteError(note) ?? undefined,
      };
      setErrors(next);
      if (parsed === null || next.note) return;
      // Waiting is not geofenced; the position is recorded with it.
      const fix = await flow.locate({ geofenced: false });
      if (!fix) return;
      const outcome = await flow.perform({
        kind: 'WAITING',
        body: waitingBody(fix, parsed, note, tappedAt),
      });
      if (outcome) onDone();
    });

  return (
    <View className="gap-4">
      <Text tone="secondary">
        Minutes the client kept you waiting after the start. It can be logged once per shoot.
      </Text>
      <Input
        label="Minutes waited"
        value={minutes}
        onChangeText={setMinutes}
        keyboardType="number-pad"
        inputMode="numeric"
        error={errors.minutes}
        testID="waiting-minutes"
      />
      <Input
        label="What happened?"
        value={note}
        onChangeText={setNote}
        multiline
        error={errors.note}
        hint="For Clickco only — the client never sees this note."
        testID="waiting-note"
      />
      <FlowStatus flow={flow} />
      <Button
        label="Log waiting time"
        loading={flow.busy}
        onPress={() => void submit()}
        testID="confirm-waiting"
      />
    </View>
  );
}

export interface WaitingCardProps {
  readonly assignmentId: string;
  readonly waiting: JobProjection['waiting'];
}

/** T&C §2.6 waiting time (ADR-0013 D9): once per assignment, with a note and a position. */
export function WaitingCard({ assignmentId, waiting }: WaitingCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Waiting time"
      subtitle="If the client kept you waiting after the start, log it once."
    >
      <Card className="gap-3">
        {waiting ? (
          <ListRow
            icon={Hourglass}
            iconTone="success"
            title="Waiting logged"
            subtitle={`At ${formatClock(waiting.at)} · logged once per shoot`}
            value={waiting.minutes === null ? undefined : `${waiting.minutes} min`}
          />
        ) : (
          <Button
            label="Log waiting time"
            icon={Hourglass}
            variant="secondary"
            onPress={() => setOpen(true)}
            testID="log-waiting"
          />
        )}
      </Card>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Log waiting time">
        <WaitingForm assignmentId={assignmentId} onDone={() => setOpen(false)} />
      </BottomSheet>
    </Section>
  );
}
