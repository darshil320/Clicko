import type { BookingDetail, BookingStatus } from '@clickco/contracts';
import {
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ListRow,
  Screen,
  Section,
  Skeleton,
  StatusBadge,
  Text,
  TierBadge,
} from '@clickco/ui';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import { useState } from 'react';
import { View } from 'react-native';
import { canCancel, isHalted, journey, statusPresentation } from '@/shared/booking-status';
import { categoryLabel } from '@/shared/catalogue';
import { userMessage } from '@/shared/errors';
import { formatDateTime, formatHours, formatShootWindow } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';
import { useBooking, useCancelBooking } from '../hooks';
import { JourneyTimeline } from './JourneyTimeline';

const POLL_MS = 15_000;

/** What the client sees about the current phase. Live tracking, extensions and delivery (Screens 7–10) build on these slots. */
function phaseNote(status: BookingStatus, balance: string): { title: string; body: string } | null {
  switch (status) {
    case 'QUOTED':
    case 'ADVANCE_PENDING':
      return { title: 'Payment pending', body: 'Pay the advance to confirm your shoot.' };
    case 'CONFIRMED':
    case 'DISPATCHING':
      return { title: "You're booked", body: "We'll assign your photographer within 2 hours." };
    case 'ASSIGNED':
    case 'EN_ROUTE':
      return {
        title: 'Your photographer is set',
        body: 'Their profile, masked calling and live tracking appear here on the shoot day.',
      };
    case 'CHECKED_IN':
    case 'IN_PROGRESS':
      return {
        title: 'Shoot in progress',
        body: 'The live timer and any extension requests from your photographer appear here.',
      };
    case 'CHECKED_OUT':
    case 'UPLOADING':
    case 'PROCESSING':
    case 'QA':
      return {
        title: 'Preparing your photos',
        body: 'RAW + JPEG files arrive within 48 hours of the shoot.',
      };
    case 'BALANCE_PENDING':
      return {
        title: 'Your photos are ready',
        body: `Pay the balance of ${balance} to unlock your download link. Balance payment opens here soon.`,
      };
    case 'DELIVERED':
    case 'CLOSED':
      return {
        title: 'Delivered',
        body: 'Your download links live here — JPEGs for 30 days, RAW files for 7.',
      };
    default:
      return null;
  }
}

function Loaded({ detail, onPay }: { detail: BookingDetail; onPay: (id: string) => void }) {
  const { booking, timeline, invoices } = detail;
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const cancel = useCancelBooking(booking.id);
  const status = statusPresentation(booking.status);
  const note = phaseNote(booking.status, rupees(booking.balancePaise));

  return (
    <>
      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <StatusBadge label={status.label} tone={status.tone} />
          <TierBadge tier={booking.tier} />
        </View>
        <Text variant="display" accessibilityRole="header">
          {categoryLabel(booking.categoryCode)} shoot
        </Text>
        <Text variant="caption" tone="tertiary" tabular>
          Booking {booking.reference}
        </Text>
      </View>

      {note ? (
        <Card tone={booking.status === 'BALANCE_PENDING' ? 'warning' : 'default'} className="gap-1">
          <Text variant="bodyStrong">{note.title}</Text>
          <Text variant="caption" tone="secondary">
            {note.body}
          </Text>
        </Card>
      ) : null}

      {canCancel(booking.status) ? (
        <Button
          label={`Pay ${rupees(booking.advancePaise)}`}
          onPress={() => onPay(booking.id)}
          testID="resume-pay"
        />
      ) : null}

      {isHalted(booking.status) ? null : (
        <Section title="Progress">
          <Card>
            <JourneyTimeline steps={journey(booking.status)} />
          </Card>
        </Section>
      )}

      <Section title="Details">
        <Card padding="list">
          <ListRow
            title="When"
            value={formatShootWindow(booking.scheduledStart, booking.scheduledHours)}
            divider
          />
          <ListRow title="Duration" value={formatHours(booking.scheduledHours)} divider />
          <ListRow title="Venue" subtitle={booking.venueAddress} value={booking.cityName} />
        </Card>
      </Section>

      <Section title="Payment">
        <Card padding="list">
          <ListRow title="Total" value={rupees(booking.totalPaise)} divider />
          <ListRow title="Paid" value={rupees(booking.amountPaidPaise)} divider />
          <ListRow title="Balance" value={rupees(booking.balancePaise)} emphasis />
        </Card>
      </Section>

      {timeline.length > 0 ? (
        <Section title="Activity">
          <Card padding="list">
            {timeline.map((entry, i) => (
              <ListRow
                key={`${entry.toStatus}-${entry.occurredAt}`}
                title={statusPresentation(entry.toStatus).label}
                subtitle={entry.reason ?? undefined}
                value={formatDateTime(entry.occurredAt)}
                divider={i < timeline.length - 1}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {invoices.length > 0 ? (
        <Section title="Tax invoices">
          <Card padding="list">
            {invoices.map((invoice, i) => (
              <ListRow
                key={invoice.invoiceNumber}
                title={invoice.invoiceNumber}
                subtitle={`${invoice.purpose === 'ADVANCE' ? 'Advance' : invoice.purpose.toLowerCase()} · ${formatDateTime(invoice.issuedAt)}`}
                value={rupees(invoice.totalPaise)}
                divider={i < invoices.length - 1}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {canCancel(booking.status) ? (
        <View className="items-center">
          <Button
            label="Cancel booking"
            variant="ghost"
            onPress={() => setConfirmingCancel(true)}
            testID="cancel"
          />
        </View>
      ) : null}

      <BottomSheet
        visible={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
        title="Cancel this booking?"
      >
        <View className="gap-4">
          <Text tone="secondary">
            Nothing has been charged yet, so there is no fee to cancel now.
          </Text>
          {cancel.isError ? <Text tone="danger">{userMessage(cancel.error)}</Text> : null}
          <Button
            label="Yes, cancel booking"
            variant="secondary"
            loading={cancel.isPending}
            onPress={() =>
              cancel.mutate(undefined, { onSuccess: () => setConfirmingCancel(false) })
            }
          />
          <Button label="Keep booking" variant="ghost" onPress={() => setConfirmingCancel(false)} />
        </View>
      </BottomSheet>
    </>
  );
}

export interface BookingDetailViewProps {
  readonly bookingId: string;
  readonly onPay: (bookingId: string) => void;
}

/** Booking detail: status, journey and history from GET /bookings/:id (polled while live). */
export function BookingDetailView({ bookingId, onPay }: BookingDetailViewProps) {
  const detail = useBooking(bookingId, POLL_MS);

  return (
    <Screen topInset={false}>
      {detail.isPending ? (
        <View className="gap-4">
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </View>
      ) : detail.isError ? (
        <EmptyState
          icon={CircleAlert}
          title="We couldn't load this booking"
          body={userMessage(detail.error)}
          action={{ label: 'Try again', onPress: () => void detail.refetch() }}
        />
      ) : (
        <Loaded detail={detail.data} onPay={onPay} />
      )}
    </Screen>
  );
}
