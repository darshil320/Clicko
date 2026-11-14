import type { PriceQuote } from '@clickco/contracts';
import {
  BottomSheet,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
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
import { openLegal } from '@/shared/legal';
import { screenState } from '@/shared/screen-state';
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
      {view.peakSeason ? (
        <Card className="gap-1" testID="peak-season">
          <Text variant="bodyStrong">Peak season: stricter cancellation</Text>
          <Text tone="secondary">{view.peakSeason}</Text>
        </Card>
      ) : null}
    </Section>
  );
}

/** The itemised price, or why it is missing and the one thing to do about it. */
function QuoteBlock({
  quote,
  priced,
  onRetry,
  onStartOver,
}: {
  quote: ReturnType<typeof useQuote>;
  priced: PriceQuote | null;
  onRetry: () => void;
  onStartOver: () => void;
}) {
  const state = screenState(quote);
  if (state.kind === 'loading') return <Skeleton className="h-56 w-full rounded-lg" />;
  if (state.kind === 'offline' || state.kind === 'error') {
    return (
      <ErrorState
        variant="card"
        offline={state.kind === 'offline'}
        title="The price didn't load"
        body={state.message}
        retrying={state.retrying}
        onRetry={onRetry}
        testID="quote-error"
      />
    );
  }
  if (!priced) {
    return (
      <EmptyState
        variant="card"
        icon={Receipt}
        title="This plan is quoted on request"
        body="Pick another plan to book and pay online now."
        action={{ label: 'Start over', onPress: onStartOver }}
      />
    );
  }
  return <Breakdown quote={priced} />;
}

function TermsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Booking terms in brief">
      <View className="gap-4">
        <Text tone="secondary">Your advance confirms the booking and reserves a photographer.</Text>
        <Text tone="secondary">
          Photos are delivered as RAW + JPEG within 48 hours of check-out, once the balance is paid.
          Editing is not included.
        </Text>
        <View className="gap-1">
          <Text variant="bodyStrong">If you cancel</Text>
          <Text tone="secondary">3 days or more before the shoot: your advance back in full.</Text>
          <Text tone="secondary">24 to 72 hours before: 50% of your advance back.</Text>
          <Text tone="secondary">Less than 24 hours before: no refund.</Text>
          <Text tone="secondary">
            Peak season, less than 7 days before: 50% of your advance back.
          </Text>
          <Text tone="secondary">
            Same-day and emergency bookings: a full refund until a photographer accepts, none after.
          </Text>
          <Text tone="secondary">
            Refunds reach your original payment method in 7–10 working days.
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Full terms"
            variant="ghost"
            size="compact"
            onPress={() => openLegal('terms')}
          />
          <Button
            label="Refund policy"
            variant="ghost"
            size="compact"
            onPress={() => openLegal('refunds')}
          />
          <Button
            label="Privacy"
            variant="ghost"
            size="compact"
            onPress={() => openLegal('privacy')}
          />
          <Button
            label="Grievances"
            variant="ghost"
            size="compact"
            onPress={() => openLegal('grievance')}
          />
        </View>
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

      <QuoteBlock
        quote={quote}
        priced={priced}
        onRetry={() => void quote.refetch()}
        onStartOver={onStartOver}
      />

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
              accessibilityLabel="Optional: Clickco may feature photos from this shoot in its portfolio"
              label="Optional: Clickco may feature photos from this shoot in its portfolio (model release). We never feature a photo in which a child can be identified. You can withdraw this later."
              testID="model-release"
            />
          )}
        />
      </View>
      <TermsSheet visible={termsOpen} onClose={() => setTermsOpen(false)} />
    </Screen>
  );
}
