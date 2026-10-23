import {
  Button,
  Card,
  EmptyState,
  ListRow,
  Screen,
  Skeleton,
  StatusBadge,
  Text,
} from '@clickco/ui';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import { useEffect } from 'react';
import { View } from 'react-native';
import { awaitingPayment, isHalted, statusPresentation } from '@/shared/booking-status';
import { useBookingDetail } from '@/shared/bookings-query';
import { IS_DEV } from '@/shared/config';
import { userMessage } from '@/shared/errors';
import { formatDateTime, formatShootWindow } from '@/shared/format/datetime';
import { useOpenPayment, useSimulatePayment } from '../hooks';
import { rupees } from '../lib/quote-view';
import { useBookingDraft } from '../store';

export interface PaymentViewProps {
  readonly bookingId: string;
  readonly onConfirmed: (bookingId: string) => void;
  readonly onViewBooking: (bookingId: string) => void;
}

/**
 * Step 4 — pay the advance. Razorpay checkout lands before launch; development builds use
 * the API's sandbox gateway, whose "Simulate payment" goes through the real signed-webhook path.
 */
export function PaymentView({ bookingId, onConfirmed, onViewBooking }: PaymentViewProps) {
  const detail = useBookingDetail(bookingId);
  const stored = useBookingDraft((s) =>
    s.payment?.bookingId === bookingId ? s.payment.payment : null,
  );
  const open = useOpenPayment(bookingId);
  const simulate = useSimulatePayment(bookingId);
  const booking = detail.data?.booking;
  const payment = stored ?? open.data ?? null;
  const paid = booking !== undefined && !awaitingPayment(booking.status);

  const confirmed = paid && !isHalted(booking.status);
  useEffect(() => {
    if (!confirmed) return;
    // Only finish the checkout that created this booking; never wipe an unrelated new draft.
    if (useBookingDraft.getState().created?.bookingId === bookingId)
      useBookingDraft.getState().clear();
    onConfirmed(bookingId);
  }, [confirmed, bookingId, onConfirmed]);

  if (detail.isPending) {
    return (
      <Screen topInset={false}>
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </Screen>
    );
  }
  if (detail.isError || !booking) {
    return (
      <Screen topInset={false}>
        <EmptyState
          icon={CircleAlert}
          title="We couldn't load this booking"
          body={detail.isError ? userMessage(detail.error) : undefined}
          action={{ label: 'Try again', onPress: () => void detail.refetch() }}
        />
      </Screen>
    );
  }

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
      <Text variant="micro" tone="tertiary">
        Step 4 of 4
      </Text>
      <View className="gap-2">
        <Text variant="h1">Pay to confirm</Text>
        <StatusBadge label={status.label} tone={status.tone} />
      </View>

      <Card>
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
          <Text variant="caption" tone="tertiary">
            Price held until {formatDateTime(booking.quoteExpiresAt)}.
          </Text>
        ) : null}
      </Card>

      {payment && sandbox ? (
        <Card tone="warning">
          <Text variant="bodyStrong">Sandbox payment</Text>
          <Text variant="caption" tone="secondary" className="mt-1">
            {IS_DEV
              ? 'Development build: no money moves. "Simulate payment" signs a sandbox webhook exactly like the gateway would.'
              : 'This server uses the sandbox gateway, which only development builds can complete.'}
          </Text>
        </Card>
      ) : payment ? (
        <Card>
          <Text variant="bodyStrong">Card and UPI checkout is coming</Text>
          <Text variant="caption" tone="secondary" className="mt-1">
            Your booking is held while we finish setting up online payments. Our team will call you
            to complete it.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
