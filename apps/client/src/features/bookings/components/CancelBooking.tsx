import type { BookingSummary, CancelBookingResponse, CancellationQuote } from '@clickco/contracts';
import {
  BottomSheet,
  Button,
  Card,
  ErrorState,
  IconTile,
  ListRow,
  Skeleton,
  StatusBadge,
  Text,
} from '@clickco/ui';
import CalendarX from 'lucide-react-native/icons/calendar-x';
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';
import { statusPresentation } from '@/shared/booking-status';
import { userMessage } from '@/shared/errors';
import { useCancelBooking, useCancellationQuote } from '../hooks';
import {
  type CancelFailure,
  cancelEntry,
  cancelFailure,
  outcomeCopy,
  quoteCopy,
} from '../lib/cancellation';

function QuoteSkeleton() {
  return (
    <View className="gap-3" testID="cancel-quote-loading">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-button w-full rounded-md" />
    </View>
  );
}

/** The booking is cancelled: its new status, and the refund on its way in plain words. */
function Cancelled({ result, onDone }: { result: CancelBookingResponse; onDone: () => void }) {
  const status = statusPresentation(result.status);
  const refunding = result.cancellation.refundPaise > 0;
  return (
    <View className="gap-5" accessibilityLiveRegion="polite" testID="cancel-done">
      <View className="flex-row items-center gap-3">
        <IconTile icon={CalendarX} size="md" shape="circle" />
        <StatusBadge label={status.label} tone={status.tone} />
      </View>
      <View className="gap-2">
        <Text variant="h2" accessibilityRole="header">
          Your booking is cancelled
        </Text>
        <Text tone="secondary" tabular>
          {outcomeCopy(result.cancellation)}
        </Text>
        {refunding ? (
          <Text variant="caption" tone="secondary">
            You can follow it under Refunds & credits on this booking.
          </Text>
        ) : null}
      </View>
      <Button label="Done" variant="secondary" onPress={onDone} testID="cancel-done-close" />
    </View>
  );
}

/** Not cancellable now: the API's reason, and a way out. */
function NotNow({ reason, onClose }: { reason: string; onClose: () => void }) {
  return (
    <View className="gap-5" testID="cancel-not-now">
      <Text tone="secondary">{reason}</Text>
      <Button label="Close" variant="secondary" onPress={onClose} />
    </View>
  );
}

interface ConfirmProps {
  readonly quote: CancellationQuote;
  readonly failure: CancelFailure | null;
  readonly pending: boolean;
  readonly onConfirm: () => void;
  readonly onKeep: () => void;
}

/** The quote in plain words, then the destructive confirm and an equally plain way to keep it. */
function Confirm({ quote, failure, pending, onConfirm, onKeep }: ConfirmProps) {
  const copy = quoteCopy(quote);
  const changed = failure?.next === 'requote';
  const blocked = failure !== null && (failure.next === 'refresh' || failure.next === 'final');
  return (
    <View className="gap-4" testID="cancel-confirm">
      {changed ? (
        <Card tone="warning" className="gap-1" testID="cancel-terms-changed">
          <Text variant="bodyStrong">The amount has changed</Text>
          <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
            {failure.message}
          </Text>
        </Card>
      ) : null}
      <View className="gap-2">
        <Text variant="bodyStrong" tabular testID="cancel-summary">
          {copy.summary}
        </Text>
        {copy.reason ? <Text tone="secondary">{copy.reason}</Text> : null}
      </View>
      {copy.rows.length > 0 ? (
        <Card padding="list">
          {copy.rows.map((row, i) => (
            <ListRow
              key={row.key}
              title={row.label}
              value={row.value}
              emphasis={row.key === 'back'}
              divider={i < copy.rows.length - 1}
            />
          ))}
        </Card>
      ) : null}
      {copy.deadline ? (
        <Text variant="caption" tone="secondary" tabular>
          {copy.deadline}
        </Text>
      ) : null}
      {failure && !changed ? (
        <Text tone="danger" accessibilityLiveRegion="polite" testID="cancel-error">
          {failure.message}
        </Text>
      ) : null}
      <View className="gap-2">
        {blocked ? null : (
          <Button
            label="Cancel booking"
            variant="danger"
            loading={pending}
            onPress={onConfirm}
            accessibilityHint="Cancels this booking. This can't be undone."
            testID="cancel-confirm-button"
          />
        )}
        <Button
          label={blocked ? 'Close' : 'Keep booking'}
          variant="ghost"
          onPress={onKeep}
          testID="cancel-keep"
        />
      </View>
    </View>
  );
}

/**
 * "Cancel booking" on the booking detail (ADR-0031). Offered only when the API's quote says the
 * booking is cancellable. Opening it asks for a fresh quote, says in plain words what comes back,
 * and confirms against exactly that figure: if the terms moved meanwhile, the new figure is shown
 * and the client confirms again — never automatically.
 */
export function CancelBooking({ booking }: { booking: BookingSummary }) {
  const quote = useCancellationQuote(booking.id, booking.status);
  const cancel = useCancelBooking(booking.id);
  const [open, setOpen] = useState(false);
  /** When the sheet last asked for a quote: older answers are never shown as the terms. */
  const [askedAt, setAskedAt] = useState(0);
  const [result, setResult] = useState<CancelBookingResponse | null>(null);
  const entry = cancelEntry(quote.data);

  const requote = () => {
    setAskedAt(Date.now());
    void quote.refetch();
  };
  const start = () => {
    cancel.reset();
    setResult(null);
    setOpen(true);
    requote();
  };
  const close = () => setOpen(false);
  const confirm = (current: CancellationQuote) =>
    cancel.mutate(
      { expectedRefundPaise: current.refundPaise },
      {
        onSuccess: setResult,
        onError: (error) => {
          if (cancelFailure(error).next === 'requote') requote();
        },
      },
    );

  if (!open && entry.kind === 'hidden') return null;

  const fresh = quote.data !== undefined && quote.dataUpdatedAt >= askedAt;
  const failedFresh = quote.isError && quote.errorUpdatedAt >= askedAt && !quote.isFetching;
  const failure = cancel.isError ? cancelFailure(cancel.error) : null;

  let body: ReactNode;
  if (result) body = <Cancelled result={result} onDone={close} />;
  else if (failedFresh) {
    body = (
      <ErrorState
        variant="card"
        title="We couldn't check what comes back"
        body={userMessage(quote.error)}
        retrying={quote.isFetching}
        onRetry={requote}
      />
    );
  } else if (!fresh || quote.data === undefined) body = <QuoteSkeleton />;
  else if (!quote.data.cancellable) body = <NotNow reason={quote.data.reason} onClose={close} />;
  else {
    const current = quote.data;
    body = (
      <Confirm
        quote={current}
        failure={failure}
        pending={cancel.isPending}
        onConfirm={() => confirm(current)}
        onKeep={close}
      />
    );
  }

  return (
    <>
      {entry.kind === 'offer' ? (
        <Button label="Cancel booking" variant="danger" onPress={start} testID="cancel" />
      ) : entry.kind === 'note' ? (
        <Card testID="cancel-note">
          <Text variant="caption" tone="secondary">
            {entry.text}
          </Text>
        </Card>
      ) : null}
      <BottomSheet
        visible={open}
        onClose={close}
        title={result ? undefined : 'Cancel this booking?'}
        testID="cancel-sheet"
      >
        {body}
      </BottomSheet>
    </>
  );
}
