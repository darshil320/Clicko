import type { BookingDetail } from '@clickco/contracts';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconTile,
  ListRow,
  Screen,
  Skeleton,
  StatusBadge,
  Text,
} from '@clickco/ui';
import FlaskConical from 'lucide-react-native/icons/flask-conical';
import SearchX from 'lucide-react-native/icons/search-x';
import Wallet from 'lucide-react-native/icons/wallet';
import { useEffect } from 'react';
import { View } from 'react-native';
import { awaitingPayment, isHalted, statusPresentation } from '@/shared/booking-status';
import { useBookingDetail } from '@/shared/bookings-query';
import { IS_DEV } from '@/shared/config';
import { isNotFound, userMessage } from '@/shared/errors';
import { formatDateTime, formatShootWindow } from '@/shared/format/datetime';
import { screenState } from '@/shared/screen-state';
import { useOpenPayment, useSimulatePayment } from '../hooks';
import { rupees } from '../lib/quote-view';
import { useBookingDraft } from '../store';

export interface PaymentViewProps {
  readonly bookingId: string | undefined;
  readonly onConfirmed: (bookingId: string) => void;
  readonly onViewBooking: (bookingId: string) => void;
  /** The way out when the booking does not exist (or is not this client's). */
  readonly onBackToBookings: () => void;
}

/**
 * Step 4 — pay the advance. Razorpay checkout lands before launch; development builds use
 * the API's sandbox gateway, whose "Simulate payment" goes through the real signed-webhook path.
 */
export function PaymentView(props: PaymentViewProps) {
  const { bookingId, onBackToBookings } = props;
  const detail = useBookingDetail(bookingId);
  const state = screenState(detail);

  if (!bookingId || (detail.data === undefined && isNotFound(detail.error))) {
    return (
      <Screen topInset={false}>
        <EmptyState
          icon={SearchX}
          title="We can't find this booking"
          body="It may have been removed, or it was made from another account."
          action={{ label: 'Go to bookings', onPress: onBackToBookings }}
          testID="booking-missing"
        />
      </Screen>
    );
  }
  if (state.kind === 'loading') {
    return (
      <Screen topInset={false}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </Screen>
    );
  }
  if (state.kind === 'offline' || state.kind === 'error') {
    return (
      <Screen topInset={false}>
        <ErrorState
          offline={state.kind === 'offline'}
          title="We couldn't load this booking"
          body={state.message}
          retrying={state.retrying}
          onRetry={() => void detail.refetch()}
        />
      </Screen>
    );
  }
  return <Payment {...props} bookingId={bookingId} booking={state.data.booking} />;
}

function Payment({
  bookingId,
  booking,
  onConfirmed,
  onViewBooking,
}: PaymentViewProps & { readonly bookingId: string; readonly booking: BookingDetail['booking'] }) {
  const stored = useBookingDraft((s) =>
    s.payment?.bookingId === bookingId ? s.payment.payment : null,
  );
  const open = useOpenPayment(bookingId);
  const simulate = useSimulatePayment(bookingId);
  const payment = stored ?? open.data ?? null;
  const paid = !awaitingPayment(booking.status);

  const confirmed = paid && !isHalted(booking.status);
  useEffect(() => {
    if (!confirmed) return;
    // Only finish the checkout that created this booking; never wipe an unrelated new draft.
    if (useBookingDraft.getState().created?.bookingId === bookingId)
      useBookingDraft.getState().clear();
    onConfirmed(bookingId);
  }, [confirmed, bookingId, onConfirmed]);

  const status = statusPresentation(booking.status);
  const sandbox = payment?.gateway === 'SANDBOX';
  const failure = open.error ?? simulate.error;

  return (
    <Screen
      topInset={false}
      footer={
        <>
          {failure ? (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {userMessage(failure)}
            </Text>
          ) : null}
          {payment === null ? (
            <Button
              label="Continue to payment"
              onPress={() => open.mutate()}
              loading={open.isPending}
            />
          ) : sandbox && IS_DEV ? (
            <Button
              label="Simulate payment"
              onPress={() => simulate.mutate(payment.paymentId)}
              loading={simulate.isPending || (simulate.isSuccess && !paid)}
              accessibilityHint="Development only: the sandbox gateway marks the payment captured"
              testID="simulate-payment"
            />
          ) : null}
          <Button label="View booking" variant="ghost" onPress={() => onViewBooking(bookingId)} />
        </>
      }
    >
      <View className="gap-3">
        <Text variant="micro" tone="tertiary">
          Step 4 of 4
        </Text>
        <Text variant="h1" accessibilityRole="header">
          Pay to confirm
        </Text>
        <StatusBadge label={status.label} tone={status.tone} />
      </View>

      <Card padding="list">
        <ListRow title="Booking" value={booking.reference} divider />
        <ListRow
          title="Shoot"
          value={formatShootWindow(booking.scheduledStart, booking.scheduledHours)}
          divider
        />
        <ListRow title="Total" value={rupees(booking.totalPaise)} divider />
        <ListRow
          title={payment?.authorizeOnly ? 'Authorise now' : 'Due now'}
          value={rupees(payment?.amountPaise ?? booking.advancePaise)}
          emphasis
          testID="amount-due"
        />
        {booking.quoteExpiresAt ? (
          <Text variant="caption" tone="tertiary" className="pb-3" tabular>
            Price held until {formatDateTime(booking.quoteExpiresAt)}.
          </Text>
        ) : null}
      </Card>

      {payment && sandbox ? (
        <Card tone="warning" className="flex-row gap-4">
          <IconTile icon={FlaskConical} tone="warning" size="sm" shape="circle" />
          <View className="flex-1 gap-1">
            <Text variant="bodyStrong">Sandbox payment</Text>
            <Text variant="caption" tone="secondary">
              {IS_DEV
                ? 'Development build: no money moves. "Simulate payment" signs a sandbox webhook exactly like the gateway would.'
                : 'This server uses the sandbox gateway, which only development builds can complete.'}
            </Text>
          </View>
        </Card>
      ) : payment ? (
        <Card className="flex-row gap-4">
          <IconTile icon={Wallet} size="sm" shape="circle" />
          <View className="flex-1 gap-1">
            <Text variant="bodyStrong">Card and UPI checkout is coming</Text>
            <Text variant="caption" tone="secondary">
              Your booking is held while we finish setting up online payments. Our team will call
              you to complete it.
            </Text>
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
