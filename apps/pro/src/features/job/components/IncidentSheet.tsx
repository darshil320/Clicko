import { BottomSheet, Button, Card, type CardTone, Input, Text } from '@clickco/ui';
import Phone from 'lucide-react-native/icons/phone';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import type { OnsiteAction } from '@/shared/offline/queue';
import { useOnsiteFlow } from '../hooks';
import { clientAbsentBody, incidentBody, noteError } from '../lib/bodies';
import { EMERGENCY_DIAL_URL, SAFETY_LINE } from '../lib/labels';
import { formatAt } from '../lib/timing';
import { FlowStatus } from './FlowStatus';

export type IncidentKind = 'ACCESS_DENIED' | 'UNSAFE' | 'CLIENT_ABSENT';

interface IncidentCopy {
  readonly title: string;
  readonly body: string;
  readonly tone: CardTone;
  readonly noteLabel: string;
  /** Client-absent ends the booking as billed, so it is geofenced like a check-out (ADR-0013 D12). */
  readonly geofenced: boolean;
}

const COPY: Readonly<Record<IncidentKind, IncidentCopy>> = {
  ACCESS_DENIED: {
    title: 'Access denied',
    body: "Tell us who refused you entry and what they said. Clickco's ops team is alerted as soon as this arrives.",
    tone: 'warning',
    noteLabel: 'What happened?',
    geofenced: false,
  },
  UNSAFE: {
    title: 'Unsafe site',
    body: `${SAFETY_LINE} Then tell us what is wrong — Clickco's ops team is alerted at once.`,
    tone: 'emergency',
    noteLabel: 'What is unsafe?',
    geofenced: false,
  },
  CLIENT_ABSENT: {
    title: 'Client not here',
    body: "Use this when the client still hasn't turned up 60 minutes after the start. It ends the shoot as completed with 0 frames, and Clickco reviews the booking.",
    tone: 'default',
    noteLabel: 'What did you try?',
    geofenced: true,
  },
};

function actionFor(
  kind: IncidentKind,
  fix: Parameters<typeof incidentBody>[0],
  note: string,
  tappedAt: Date,
): OnsiteAction {
  switch (kind) {
    case 'ACCESS_DENIED':
      return { kind: 'ACCESS_DENIED', body: incidentBody(fix, note, tappedAt) };
    case 'UNSAFE':
      return { kind: 'UNSAFE', body: incidentBody(fix, note, tappedAt) };
    case 'CLIENT_ABSENT':
      return { kind: 'CLIENT_ABSENT', body: clientAbsentBody(fix, note, tappedAt) };
  }
}

interface IncidentFormProps {
  readonly kind: IncidentKind;
  readonly assignmentId: string;
  readonly clientAbsentOpensAt: string | null;
  readonly now: Date;
  readonly onDone: () => void;
}

function IncidentForm({ kind, assignmentId, clientAbsentOpensAt, now, onDone }: IncidentFormProps) {
  const copy = COPY[kind];
  const flow = useOnsiteFlow(assignmentId);
  const [note, setNote] = useState('');
  const [noteProblem, setNoteProblem] = useState<string | undefined>();

  const submit = () =>
    flow.run(async () => {
      const tappedAt = new Date();
      const problem = noteError(note);
      setNoteProblem(problem ?? undefined);
      if (problem) return;
      // Incidents are never blocked by GPS quality: whatever fix we get is sent (ADR-0024 D4).
      const fix = await flow.locate({ geofenced: copy.geofenced, safety: !copy.geofenced });
      if (!fix) return;
      const outcome = await flow.perform(actionFor(kind, fix, note, tappedAt));
      if (outcome) onDone();
    });

  const opensHint =
    kind === 'CLIENT_ABSENT' &&
    clientAbsentOpensAt &&
    Date.parse(clientAbsentOpensAt) > now.getTime()
      ? `You can send this from ${formatAt(clientAbsentOpensAt, now)}.`
      : undefined;

  return (
    <View className="gap-4">
      <Card tone={copy.tone}>
        <Text>{copy.body}</Text>
      </Card>
      <Input
        label={copy.noteLabel}
        value={note}
        onChangeText={setNote}
        multiline
        error={noteProblem}
        hint="For Clickco only — the client never sees this note."
        testID="incident-note"
      />
      <FlowStatus flow={flow} hint={opensHint} />
      <Button
        label="Send report"
        loading={flow.busy}
        onPress={() => void submit()}
        testID="send-report"
      />
      {kind === 'UNSAFE' ? (
        <Button
          label="Call 112"
          icon={Phone}
          variant="secondary"
          onPress={() => {
            Linking.openURL(EMERGENCY_DIAL_URL).catch(() =>
              flow.fail("Couldn't start a call from this phone — dial 112 yourself."),
            );
          }}
          accessibilityHint="Calls India's emergency number"
          testID="call-112"
        />
      ) : null}
    </View>
  );
}

export interface IncidentSheetProps {
  readonly kind: IncidentKind | null;
  readonly assignmentId: string;
  readonly clientAbsentOpensAt: string | null;
  readonly now: Date;
  readonly onClose: () => void;
}

/** One sheet for the three on-site reports. The form remounts per opening, so it starts empty. */
export function IncidentSheet({ kind, onClose, ...rest }: IncidentSheetProps) {
  return (
    <BottomSheet
      visible={kind !== null}
      onClose={onClose}
      title={kind ? COPY[kind].title : undefined}
    >
      {kind ? <IncidentForm key={kind} kind={kind} onDone={onClose} {...rest} /> : null}
    </BottomSheet>
  );
}
