import type { PlanTier } from '@clickco/contracts';
import {
  BottomSheet,
  Button,
  Card,
  Icon,
  IconTile,
  ListRow,
  Screen,
  Section,
  Skeleton,
  Text,
  TIER_LABEL,
  TierBadge,
} from '@clickco/ui';
import Camera from 'lucide-react-native/icons/camera';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import X from 'lucide-react-native/icons/x';
import { useState } from 'react';
import { View } from 'react-native';
import { type BookableTier, isBookableTier, NOT_INCLUDED, TIER_COPY } from '@/shared/catalogue';
import { userMessage } from '@/shared/errors';
import { useReferenceQuote, useTierPrices } from '../hooks';
import { fromPricePaise, hourlyRatePaise, rupees } from '../lib/quote-view';

function CompareSheet({
  visible,
  onClose,
  pincode,
}: {
  visible: boolean;
  onClose: () => void;
  pincode: string;
}) {
  const prices = useTierPrices(pincode);
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Compare tiers">
      {prices.map(({ tier, query }) => {
        const from = fromPricePaise(query?.data);
        return (
          <ListRow
            key={tier}
            title={TIER_LABEL[tier]}
            subtitle={`${TIER_COPY[tier].framesPerHour} delivered frames per hour · ${TIER_COPY[tier].gear}`}
            value={from === null ? '—' : rupees(from)}
            divider
          />
        );
      })}
      <ListRow title="Signature" subtitle={TIER_COPY.SIGNATURE.gear} value="On request" />
      <Text variant="caption" tone="tertiary" className="mt-3">
        Prices are for 2 hours, before 18% GST.
      </Text>
    </BottomSheet>
  );
}

function PriceBlock({ tier, pincode }: { tier: BookableTier; pincode: string }) {
  const quote = useReferenceQuote(tier, pincode);
  if (quote.isPending) {
    return (
      <View className="gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-full" />
      </View>
    );
  }
  if (quote.isError || quote.data?.kind !== 'QUOTE') {
    return (
      <View className="gap-2">
        <Text tone="danger">{quote.isError ? userMessage(quote.error) : 'Price unavailable'}</Text>
        <Button
          label="Try again"
          variant="secondary"
          size="compact"
          onPress={() => void quote.refetch()}
        />
      </View>
    );
  }
  const hourly = hourlyRatePaise(quote.data);
  return (
    <View className="gap-1">
      <View className="flex-row flex-wrap items-baseline gap-2">
        <Text variant="display" tabular>
          {rupees(quote.data.subtotalPaise)}
        </Text>
        <Text tone="secondary">for 2 hours</Text>
      </View>
      <Text variant="caption" tone="tertiary" tabular>
        + GST{hourly === null ? '' : ` · extra hours from ${rupees(hourly)}/hr`}
      </Text>
    </View>
  );
}

export interface PlanDetailViewProps {
  readonly tier: PlanTier;
  readonly pincode: string;
  readonly onContinue: (tier: BookableTier) => void;
}

/** Screen 2 — what a tier includes, its live price, and the way in to the configurator. */
export function PlanDetailView({ tier, pincode, onContinue }: PlanDetailViewProps) {
  const [showExcluded, setShowExcluded] = useState(false);
  const [comparing, setComparing] = useState(false);
  const bookable = isBookableTier(tier);
  const quote = useReferenceQuote(bookable ? tier : null, pincode);
  const from = fromPricePaise(quote.data);
  const copy = TIER_COPY[tier];

  return (
    <Screen
      topInset={false}
      footer={
        bookable ? (
          <Button
            label={from === null ? 'Continue' : `Continue — ${rupees(from)}`}
            onPress={() => onContinue(tier)}
            testID="plan-continue"
          />
        ) : (
          <Text tone="secondary" align="center">
            Signature is booked by enquiry. Our team will call you to plan the shoot.
          </Text>
        )
      }
    >
      <View
        accessible
        accessibilityLabel={`${TIER_LABEL[tier]} sample photography`}
        className="-mx-5 -mt-4 aspect-video items-center justify-center border-b border-border-subtle bg-surface-raised"
      >
        <IconTile icon={Camera} size="lg" shape="circle" />
      </View>
      <View className="gap-3">
        <TierBadge tier={tier} />
        <Text variant="display" accessibilityRole="header">
          {TIER_LABEL[tier]}
        </Text>
        <Text tone="secondary">{copy.tagline}</Text>
      </View>
      {bookable ? (
        <PriceBlock tier={tier} pincode={pincode} />
      ) : (
        <Text variant="h1">On request</Text>
      )}

      <Section title="What's included">
        <Card padding="list">
          {copy.included.map((item, i) => (
            <ListRow
              key={item}
              title={item}
              icon={Check}
              iconTone="success"
              divider={i < copy.included.length - 1}
            />
          ))}
        </Card>
      </Section>

      <Card padding="list">
        <ListRow
          title="What's not included"
          emphasis
          divider={showExcluded}
          onPress={() => setShowExcluded((open) => !open)}
          accessory={<Icon icon={showExcluded ? ChevronUp : ChevronDown} tone="tertiary" />}
          accessibilityLabel={
            showExcluded ? "Hide what's not included" : "Show what's not included"
          }
        />
        {showExcluded
          ? NOT_INCLUDED.map((item) => (
              <ListRow key={item} title={item} icon={X} iconTone="tertiary" />
            ))
          : null}
      </Card>

      <View className="items-start">
        <Button
          label="Compare all tiers"
          variant="ghost"
          size="compact"
          onPress={() => setComparing(true)}
        />
      </View>
      <CompareSheet visible={comparing} onClose={() => setComparing(false)} pincode={pincode} />
    </Screen>
  );
}
