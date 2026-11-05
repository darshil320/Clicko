import type { AccountDeletionPreview } from '@clickco/contracts';
import { Button, Card, ListRow, Screen, Section, Skeleton, StateView, Text } from '@clickco/ui';
import { useEffect } from 'react';
import { View } from 'react-native';
import { formatPhone } from '@/shared/format/phone';
import { screenState } from '@/shared/screen-state';
import { useSession } from '@/shared/session/store';
import { useBookingsForBlockers, useDeletionPreview, useRequestDeletion } from '../hooks';
import { blockerView, deletionFailure, forfeitLine } from '../lib/deletion';
import { useDeletionFlow } from '../store';
import { CodeStep } from './CodeStep';

function PreviewSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </View>
  );
}

/** A list from the API, one plain line per row. */
function Lines({ lines, testID }: { lines: readonly string[]; testID: string }) {
  return (
    <Card padding="list" testID={testID}>
      {lines.map((line, i) => (
        <ListRow key={line} title={line} divider={i < lines.length - 1} />
      ))}
    </Card>
  );
}

function Blockers({
  preview,
  onOpenBooking,
}: {
  preview: AccountDeletionPreview;
  onOpenBooking: (bookingId: string) => void;
}) {
  const bookings = useBookingsForBlockers();
  return (
    <Section
      title="You can't delete your account yet"
      subtitle="Once these are done, come back here."
      testID="deletion-blockers"
    >
      {preview.blockers.map((blocker) => {
        const view = blockerView(blocker, bookings.data);
        return (
          <Card key={view.key} tone="warning" className="gap-3">
            <View className="gap-1">
              <Text variant="bodyStrong">{view.title}</Text>
              <Text variant="caption" tone="secondary">
                {view.body}
              </Text>
            </View>
            <Button
              label={view.actionLabel}
              variant="secondary"
              size="compact"
              onPress={() => onOpenBooking(view.bookingId)}
              accessibilityLabel={`${view.actionLabel}: ${blocker.reference}`}
            />
          </Card>
        );
      })}
    </Section>
  );
}

function Explanation({
  preview,
  onOpenBooking,
}: {
  preview: AccountDeletionPreview;
  onOpenBooking: (bookingId: string) => void;
}) {
  const forfeit = forfeitLine(preview.forfeitedCreditPaise);
  return (
    <>
      <View className="gap-2">
        <Text variant="h1" accessibilityRole="header">
          Delete your account
        </Text>
        <Text tone="secondary">
          Here is what happens when you do. Nothing is deleted until you enter the code we text you.
        </Text>
      </View>
      {preview.canDelete ? null : <Blockers preview={preview} onOpenBooking={onOpenBooking} />}
      {forfeit ? (
        <Card tone="warning" className="gap-1" testID="deletion-forfeit">
          <Text variant="bodyStrong" tabular>
            {forfeit}
          </Text>
          <Text variant="caption" tone="secondary">
            Credit can't be moved to another account or paid out.
          </Text>
        </Card>
      ) : null}
      <Section title="What we erase">
        <Lines lines={preview.erases} testID="deletion-erases" />
      </Section>
      <Section title="What we keep, and why">
        <Lines lines={preview.keeps} testID="deletion-keeps" />
      </Section>
    </>
  );
}

/** Step one: send the code. Only offered when nothing blocks the deletion. */
function SendCode({ phone }: { phone: string | null }) {
  const request = useRequestDeletion();
  const failure = request.isError ? deletionFailure(request.error) : null;
  return (
    <>
      {failure ? (
        <Text tone="danger" accessibilityLiveRegion="polite" testID="deletion-request-error">
          {failure.message}
        </Text>
      ) : (
        <Text variant="caption" tone="secondary" tabular>
          {phone
            ? `We'll text a 6-digit code to ${formatPhone(phone)} to check it's you.`
            : "We'll text a 6-digit code to your phone to check it's you."}
        </Text>
      )}
      <Button
        label="Send code"
        variant="danger"
        loading={request.isPending}
        onPress={() => request.mutate()}
        accessibilityHint="Texts you a code. Your account is not deleted yet."
        testID="deletion-send-code"
      />
    </>
  );
}

export interface DeleteAccountViewProps {
  /** A blocker's way forward: the booking that is in the way. */
  readonly onOpenBooking: (bookingId: string) => void;
  /** "Keep my account": leave the flow. */
  readonly onKeep: () => void;
}

/**
 * Profile → "Delete account" (ADR-0030): the explanation from GET /me/deletion (what is erased,
 * what is kept and why, any credit lost, anything in the way), then two deliberate steps: send
 * the code, then enter it and delete. Leaving the screen at any point deletes nothing.
 */
export function DeleteAccountView({ onOpenBooking, onKeep }: DeleteAccountViewProps) {
  const preview = useDeletionPreview();
  const sent = useDeletionFlow((s) => s.sent);
  const reset = useDeletionFlow((s) => s.reset);
  const phone = useSession((s) => s.user?.phone ?? null);
  const state = screenState(preview);

  // Leaving the screen ends the attempt: the next visit starts at the explanation.
  useEffect(() => reset, [reset]);

  if (sent && phone) return <CodeStep sent={sent} phone={phone} onKeep={onKeep} />;

  const ready = state.kind === 'ready' && state.data.canDelete;
  return (
    <Screen topInset={false} footer={ready ? <SendCode phone={phone} /> : undefined}>
      <StateView
        state={state}
        loading={<PreviewSkeleton />}
        errorTitle="We couldn't load what deleting does"
        onRetry={() => void preview.refetch()}
      >
        {(data) => <Explanation preview={data} onOpenBooking={onOpenBooking} />}
      </StateView>
    </Screen>
  );
}
