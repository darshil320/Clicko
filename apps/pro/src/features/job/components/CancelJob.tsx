import { BottomSheet, Button, Input, ListRow, Text } from '@clickco/ui';
import { useRouter } from 'expo-router';
import Ban from 'lucide-react-native/icons/ban';
import CircleX from 'lucide-react-native/icons/circle-x';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import { useState } from 'react';
import { View } from 'react-native';
import { useCancelJob } from '../hooks';
import { CANCEL_REASON_MAX, noteError } from '../lib/bodies';
import { jobErrorMessage } from '../lib/errors';
import { ErrorText } from './FlowStatus';

/**
 * What a cancellation after acceptance does — DOMAIN §2 (ADR-0011 re-dispatch transition) and
 * ADR-0012 D7 (penalty). No penalty sizes are stated: ops applies them (S6/S9).
 */
const CONSEQUENCES = [
  {
    icon: RefreshCw,
    text: 'The job goes back to Clickco, and we look for another photographer for the client.',
  },
  { icon: Ban, text: 'A late-cancellation penalty is recorded on your profile.' },
  { icon: CircleX, text: "You won't be paid for this job." },
] as const;

function CancelForm({ assignmentId, onClose }: { assignmentId: string; onClose: () => void }) {
  const router = useRouter();
  const cancel = useCancelJob(assignmentId);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  const submit = () => {
    if (cancel.isPending) return;
    const problem = noteError(reason, CANCEL_REASON_MAX);
    setReasonError(problem ?? undefined);
    if (problem) return;
    cancel.mutate(reason, {
      onSuccess: () => {
        onClose();
        if (router.canGoBack()) router.back();
        else router.replace('/');
      },
    });
  };

  return (
    <View className="gap-4">
      <View>
        {CONSEQUENCES.map((line) => (
          <ListRow key={line.text} icon={line.icon} title={line.text} />
        ))}
      </View>
      <Input
        label="Why are you cancelling?"
        value={reason}
        onChangeText={setReason}
        multiline
        error={reasonError}
        hint="Clickco's ops team reads this."
        testID="cancel-reason"
      />
      {cancel.isError ? <ErrorText message={jobErrorMessage(cancel.error, 'CANCEL')} /> : null}
      <Button
        label="Cancel job"
        variant="secondary"
        loading={cancel.isPending}
        onPress={submit}
        testID="confirm-cancel"
      />
      <Button label="Keep the job" variant="ghost" onPress={onClose} />
    </View>
  );
}

/** Cancel before check-in only (the caller hides it after), with its consequences stated plainly. */
export function CancelJob({ assignmentId }: { assignmentId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <View className="items-center gap-1">
        <Button
          label="Cancel this job"
          variant="ghost"
          onPress={() => setOpen(true)}
          testID="cancel-job"
        />
        <Text variant="caption" tone="tertiary">
          Possible until you check in.
        </Text>
      </View>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Cancel this job?">
        <CancelForm assignmentId={assignmentId} onClose={() => setOpen(false)} />
      </BottomSheet>
    </>
  );
}
