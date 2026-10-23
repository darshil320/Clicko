import { Button, Card, EmptyState, Input, Screen, Skeleton, Text, TIER_LABEL } from '@clickco/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import CalendarDays from 'lucide-react-native/icons/calendar-days';
import { type ReactNode, useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { userMessage } from '@/shared/errors';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { useNow } from '@/shared/hooks/useNow';
import { useQuote } from '../hooks';
import { addonProbeRequest, type BookingDraft, quoteRequest, VenueForm } from '../lib/draft';
import { stepHours } from '../lib/duration';
import { addonPrices, rupees } from '../lib/quote-view';
import { clampSlot, datePills, timeSlots } from '../lib/schedule';
import { useBookingDraft } from '../store';
import {
  AddonList,
  CategoryChips,
  DatePills,
  DurationStepper,
  Section,
  TierChips,
  TimePills,
} from './ConfiguratorSections';

const QUOTE_DEBOUNCE_MS = 350;
const CLOCK_TICK_MS = 60_000;

function PriceFooter({ draft, onReview }: { draft: BookingDraft; onReview: () => void }) {
  const request = useDebouncedValue(
    useMemo(() => quoteRequest(draft), [draft]),
    QUOTE_DEBOUNCE_MS,
  );
  const quote = useQuote(request);
  const priced = quote.data?.kind === 'QUOTE' ? quote.data : null;

  return (
    <>
      <View className="flex-row items-end justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="caption" tone="secondary">
            Running total
          </Text>
          {quote.isError ? (
            <Text tone="danger" variant="caption" accessibilityLiveRegion="polite">
              {userMessage(quote.error)}
            </Text>
          ) : priced ? (
            <Text variant="h2" tabular testID="running-total">
              {rupees(priced.subtotalPaise)}{' '}
              <Text variant="caption" tone="tertiary">
                + GST
              </Text>
            </Text>
          ) : (
            <Skeleton className="h-8 w-full" />
          )}
        </View>
        {priced ? (
          <Text variant="caption" tone="secondary" tabular>
            {rupees(priced.totalPaise)} incl. GST
          </Text>
        ) : null}
      </View>
      {quote.isError ? (
        <Button label="Retry price" variant="secondary" onPress={() => void quote.refetch()} />
      ) : (
        <Button
          label="Review"
          onPress={onReview}
          disabled={!priced || quote.isPlaceholderData}
          testID="review"
        />
      )}
    </>
  );
}

export interface ConfiguratorViewProps {
  /** The saved shoot pincode; the draft follows it when the client changes location. */
  readonly pincode: string;
  /** "Vesu, Surat" — the saved shoot location. */
  readonly locationLabel: string;
  /** The location feature's "Change" control, composed in by the route. */
  readonly locationAction: ReactNode;
  readonly onReview: () => void;
  readonly onStartOver: () => void;
}

/** Screen 3 — when, how long, what kind, and add-ons, with a live total from /pricing/quote. */
export function ConfiguratorView({
  pincode,
  locationLabel,
  locationAction,
  onReview,
  onStartOver,
}: ConfiguratorViewProps) {
  const draft = useBookingDraft((s) => s.draft);
  const update = useBookingDraft((s) => s.update);
  const toggleAddon = useBookingDraft((s) => s.toggleAddon);
  const setTier = useBookingDraft((s) => s.setTier);
  const now = useNow(CLOCK_TICK_MS);
  const form = useForm<VenueForm>({
    resolver: zodResolver(VenueForm),
    defaultValues: {
      venueAddress: draft?.venueAddress ?? '',
      venueLandmark: draft?.venueLandmark ?? '',
    },
  });

  useEffect(() => {
    if (draft && draft.pincode !== pincode) update({ pincode });
  }, [draft, pincode, update]);

  // Time passes: a slot that is no longer bookable moves to the next open start.
  useEffect(() => {
    if (!draft) return;
    const slot = clampSlot({ dateKey: draft.dateKey, startMinute: draft.startMinute }, now);
    if (slot.dateKey !== draft.dateKey || slot.startMinute !== draft.startMinute) update(slot);
  }, [draft, now, update]);

  const probe = useQuote(
    useDebouncedValue(
      useMemo(() => (draft ? addonProbeRequest(draft) : null), [draft]),
      QUOTE_DEBOUNCE_MS,
    ),
  );

  if (!draft) {
    return (
      <Screen topInset={false}>
        <EmptyState
          icon={CalendarDays}
          title="Pick a plan to start"
          body="Choose a tier on Home and we'll build your booking from there."
          action={{ label: 'Back to Home', onPress: onStartOver }}
        />
      </Screen>
    );
  }

  const pills = datePills(now);
  const slots = timeSlots(draft.dateKey, now);
  const review = form.handleSubmit(onReview);

  return (
    <Screen topInset={false} footer={<PriceFooter draft={draft} onReview={() => void review()} />}>
      <Text variant="micro" tone="tertiary">
        Step 2 of 4 · {TIER_LABEL[draft.tier]}
      </Text>

      <Card className="gap-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text variant="caption" tone="secondary">
              Venue
            </Text>
            <Text variant="bodyStrong">{locationLabel}</Text>
          </View>
          {locationAction}
        </View>
        <Controller
          control={form.control}
          name="venueAddress"
          render={({ field, fieldState }) => (
            <Input
              label="Venue address"
              placeholder="14, Rajhans Platinum, Vesu"
              autoComplete="street-address"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                update({ venueAddress: text });
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              testID="venue-address"
            />
          )}
        />
        <Controller
          control={form.control}
          name="venueLandmark"
          render={({ field, fieldState }) => (
            <Input
              label="Landmark (optional)"
              placeholder="Opposite VR Mall"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                update({ venueLandmark: text });
              }}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
      </Card>

      <Section title="Date">
        <DatePills
          pills={pills}
          selected={draft.dateKey}
          onSelect={(dateKey) =>
            update(clampSlot({ dateKey, startMinute: draft.startMinute }, now))
          }
        />
      </Section>

      <Section title="Start time">
        <TimePills
          slots={slots}
          selected={draft.startMinute}
          onSelect={(startMinute) => update({ startMinute })}
        />
      </Section>

      <Section title="Duration">
        <DurationStepper
          hours={draft.hours}
          onStep={(direction) => update({ hours: stepHours(draft.hours, direction) })}
        />
      </Section>

      <Section title="Plan">
        <TierChips selected={draft.tier} onSelect={setTier} />
      </Section>

      <Section title="Category">
        <CategoryChips
          selected={draft.categoryCode}
          onSelect={(categoryCode) => update({ categoryCode })}
        />
      </Section>

      <Section title="Add-ons">
        <AddonList
          tier={draft.tier}
          selected={draft.addons}
          prices={addonPrices(probe.data)}
          pricesLoading={probe.isPending}
          onToggle={toggleAddon}
        />
      </Section>
    </Screen>
  );
}
