import type { PriceQuote } from '@clickco/contracts';
import {
  BottomSheet,
  Button,
  Card,
  Checkbox,
  EmptyState,
  IconTile,
  Input,
  ListRow,
  Screen,
  Section,
  Skeleton,
  Text,
  TIER_LABEL,
  TierBadge,
} from '@clickco/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import CalendarDays from 'lucide-react-native/icons/calendar-days';
import Receipt from 'lucide-react-native/icons/receipt';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { categoryLabel } from '@/shared/catalogue';
import { userMessage } from '@/shared/errors';
import { formatDayMonth, formatTimeRange } from '@/shared/format/datetime';
import { formatPhone } from '@/shared/format/phone';
import { useSession } from '@/shared/session/store';
import { useCheckout, useQuote } from '../hooks';
import { CheckoutForm, quoteRequest } from '../lib/draft';
import { quoteView } from '../lib/quote-view';
import { useBookingDraft } from '../store';

function Breakdown({ quote }: { quote: PriceQuote }) {
  const view = quoteView(quote);
  return (
    <Section title="Price">
      <Card padding="list">
        {view.lines.map((line) => (
          <ListRow
            key={line.key}
            title={line.label}
            subtitle={line.detail}
            value={line.amount}
            divider
          />
        ))}
        {view.factors.length > 0 ? (
          <Text variant="caption" tone="tertiary" className="py-3">
            Base includes: {view.factors.join(' · ')}
          </Text>
        ) : null}
        <ListRow title="Subtotal" value={view.subtotal} />
        {view.discount ? (
          <ListRow title="Discount" value={view.discount} valueTone="success" />
        ) : null}
        <ListRow title={view.gst.label} value={view.gst.amount} divider />
        <ListRow title="Total" value={view.total} emphasis testID="quote-total" />
      </Card>
      <Card className="gap-2">
        <ListRow title={view.payNow.label} value={view.payNow.amount} emphasis testID="pay-now" />
        {view.payNow.note ? (
          <Text variant="caption" tone="secondary">
            {view.payNow.note}
          </Text>
        ) : null}
        {view.balance ? (
          <Text variant="caption" tone="tertiary">
            Balance {view.balance} after the shoot, before your photos unlock.
          </Text>
        ) : null}
      </Card>
    </Section>
  );
}

function TermsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Booking terms in brief">
      <View className="gap-4">
        <Text tone="secondary">Your advance confirms the booking and reserves a photographer.</Text>
        <Text tone="secondary">
          Photos are delivered as RAW + JPEG within 48 hours of the shoot. Editing is not included.
        </Text>
        <Text tone="secondary">
          Cancellations and refunds follow the Clickco Terms & Conditions (v2, draft) — the full
          text is at clickco.in/terms.
        </Text>
        <Button label="Close" variant="secondary" onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

export interface ReviewViewProps {
  readonly locationLabel: string;
  readonly onPaymentOpened: (bookingId: string) => void;
  readonly onStartOver: () => void;
}

/** Screen 4 — the itemised quote from the API, consents (never pre-ticked), and Pay. */
export function ReviewView({ locationLabel, onPaymentOpened, onStartOver }: ReviewViewProps) {
  const draft = useBookingDraft((s) => s.draft);
  const user = useSession((s) => s.user);
  const [termsOpen, setTermsOpen] = useState(false);
  const quote = useQuote(useMemo(() => (draft ? quoteRequest(draft) : null), [draft]));
  const checkout = useCheckout();
  const form = useForm<CheckoutForm>({
    resolver: zodResolver(CheckoutForm),
    defaultValues: {
      bookerName: user?.fullName ?? '',
      acceptTerms: false,
      modelReleaseConsent: false,
    },
  });

  if (!draft || !user) {
    return (
      <Screen topInset={false}>
        <EmptyState
          icon={Receipt}
          title="Nothing to review yet"
          body="Pick a plan and a time first."
          action={{ label: 'Back to Home', onPress: onStartOver }}
        />
      </Screen>
    );
  }

  const priced = quote.data?.kind === 'QUOTE' ? quote.data : null;
  const pay = form.handleSubmit(({ bookerName, modelReleaseConsent }) =>
    checkout.mutate(
      { booker: { name: bookerName, phone: user.phone }, modelReleaseConsent },
      { onSuccess: ({ bookingId }) => onPaymentOpened(bookingId) },
    ),
  );
  const payLabel = priced
    ? `${priced.captureOnAcceptOnly ? 'Authorise' : 'Pay'} ${quoteView(priced).payNow.amount}`
    : 'Pay';

  return (
    <Screen
      topInset={false}
      eyebrow="Step 3 of 4"
      title="Review and pay"
      titleVariant="h1"
      footer={
        <>
          {checkout.isError ? (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {userMessage(checkout.error)}
            </Text>
          ) : null}
          <Button
            label={payLabel}
            onPress={() => void pay()}
            loading={checkout.isPending}
            disabled={!priced}
            testID="pay"
          />
        </>
      }
    >
      <Card className="flex-row gap-4">
        <IconTile icon={CalendarDays} size="md" />
        <View className="flex-1 gap-2">
          <TierBadge tier={draft.tier} />
          <Text variant="h3">
            {TIER_LABEL[draft.tier]} · {categoryLabel(draft.categoryCode)}
          </Text>
          <Text tone="secondary" tabular>
            {formatDayMonth(draft.dateKey)}, {formatTimeRange(draft.startMinute, draft.hours)}
          </Text>
          <Text tone="secondary">{draft.venueAddress.trim() || locationLabel}</Text>
        </View>
      </Card>

      {quote.isPending ? (
        <Skeleton className="h-56 w-full rounded-lg" />
      ) : quote.isError || !priced ? (
        <Card className="gap-4">
          <Text tone="danger">
            {quote.isError ? userMessage(quote.error) : 'This tier is quoted on request.'}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void quote.refetch()} />
        </Card>
      ) : (
        <Breakdown quote={priced} />
      )}

      <Section title="Your details">
        <Controller
          control={form.control}
          name="bookerName"
          render={({ field, fieldState }) => (
            <Input
              label="Your name"
              placeholder="Priya Sharma"
              autoComplete="name"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              testID="booker-name"
            />
          )}
        />
        <Text variant="caption" tone="tertiary" tabular>
          We'll share updates on {formatPhone(user.phone)}.
        </Text>
      </Section>

      <View className="gap-1">
        <Controller
          control={form.control}
          name="acceptTerms"
          render={({ field, fieldState }) => (
            <Checkbox
              checked={field.value}
              onChange={field.onChange}
              accessibilityLabel="I accept the booking terms and cancellation policy"
              error={fieldState.error?.message}
              testID="accept-terms"
              label={
                <Text>
                  I accept the booking terms and cancellation policy.{' '}
                  <Text
                    variant="bodyStrong"
                    className="underline"
                    onPress={() => setTermsOpen(true)}
                    accessibilityRole="link"
                  >
                    Read them
                  </Text>
                </Text>
              }
            />
          )}
        />
        <Controller
          control={form.control}
          name="modelReleaseConsent"
          render={({ field }) => (
            <Checkbox
              checked={field.value}
              onChange={field.onChange}
              accessibilityLabel="Optional: Clickco may use photos from this shoot in its portfolio"
              label="Optional: Clickco may feature photos from this shoot in its portfolio (model release)."
              testID="model-release"
            />
          )}
        />
      </View>
      <TermsSheet visible={termsOpen} onClose={() => setTermsOpen(false)} />
    </Screen>
  );
}
