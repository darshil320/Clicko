import type { PlanTier } from '@clickco/contracts';
import {
  Button,
  Card,
  Icon,
  IconTile,
  Reveal,
  Section,
  Skeleton,
  StatusBadge,
  Text,
  TIER_LABEL,
  TierBadge,
} from '@clickco/ui';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Zap from 'lucide-react-native/icons/zap';
import { ScrollView, View } from 'react-native';
import { CATEGORIES, TIER_COPY } from '@/shared/catalogue';
import { categoryIcon } from '@/shared/category-icons';
import { userMessage } from '@/shared/errors';
import { useTierPrices } from '../hooks';
import { fromPricePaise, rupees } from '../lib/quote-view';

/** Professional is the default recommendation (it carries the one accent on Home). */
const RECOMMENDED_TIER: PlanTier = 'PROFESSIONAL';

/** "Need a photographer today?" — the emergency red lives on its tile only. */
export function EmergencyBanner({ onPress }: { onPress: () => void }) {
  return (
    <Card
      onPress={onPress}
      accessibilityLabel="Need a photographer today? Book in the next 3 hours"
      testID="emergency-banner"
    >
      <View className="flex-row items-center gap-4">
        <IconTile icon={Zap} tone="emergency" size="md" />
        <View className="flex-1 gap-1">
          <Text variant="bodyStrong">Need a photographer today?</Text>
          <Text variant="caption" tone="secondary">
            Book in the next 3 hours
          </Text>
        </View>
        <Icon icon={ChevronRight} tone="tertiary" />
      </View>
    </Card>
  );
}

/** "Browse by need": six categories in a horizontal, edge-to-edge row of soft tiles. */
export function CategoryRow({ onSelect }: { onSelect: (categoryCode: string) => void }) {
  return (
    <Section title="Browse by need">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-5"
        contentContainerClassName="gap-3 px-5 py-1"
      >
        {CATEGORIES.slice(0, 6).map((category, i) => (
          <Reveal key={category.code} index={i}>
            <Card
              padding="compact"
              onPress={() => onSelect(category.code)}
              accessibilityLabel={`${category.label} photography`}
              className="w-28 items-center gap-3"
              testID={`category-${category.code}`}
            >
              <IconTile icon={categoryIcon(category.code)} size="md" shape="circle" />
              <Text variant="caption" align="center" numberOfLines={1}>
                {category.label}
              </Text>
            </Card>
          </Reveal>
        ))}
      </ScrollView>
    </Section>
  );
}

type PriceState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly retry: () => void }
  | { readonly kind: 'ready'; readonly fromPaise: number }
  | { readonly kind: 'onRequest' };

function TierPrice({ price }: { price: PriceState }) {
  switch (price.kind) {
    case 'loading':
      return <Skeleton className="h-7 w-full rounded-sm" />;
    case 'onRequest':
      return <Text variant="h3">On request</Text>;
    case 'error':
      return (
        <View className="flex-row items-center gap-2">
          <Text variant="caption" tone="danger" className="flex-1">
            {price.message}
          </Text>
          <Button label="Retry" variant="ghost" size="compact" onPress={price.retry} />
        </View>
      );
    case 'ready':
      return (
        <View className="flex-row flex-wrap items-baseline gap-1">
          <Text variant="caption" tone="tertiary">
            from
          </Text>
          <Text variant="h2" tabular>
            {rupees(price.fromPaise)}
          </Text>
          <Text variant="caption" tone="tertiary">
            / 2 hrs + GST
          </Text>
        </View>
      );
  }
}

export function TierCard({
  tier,
  price,
  onPress,
}: {
  tier: PlanTier;
  price: PriceState;
  onPress: () => void;
}) {
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${TIER_LABEL[tier]} plan, ${TIER_COPY[tier].tagline}`}
      className="gap-3"
      testID={`tier-${tier}`}
    >
      <View className="flex-row items-center gap-3">
        <View className="flex-1 flex-row flex-wrap items-center gap-3">
          <TierBadge tier={tier} />
          {tier === RECOMMENDED_TIER ? <StatusBadge label="Recommended" tone="accent" /> : null}
        </View>
        <Icon icon={ChevronRight} tone="tertiary" />
      </View>
      <Text tone="secondary">{TIER_COPY[tier].tagline}</Text>
      <TierPrice price={price} />
    </Card>
  );
}

/** "Choose your tier": live "from" prices for the client's pincode; Signature is on request. */
export function TierList({
  pincode,
  onSelect,
}: {
  pincode: string;
  onSelect: (tier: PlanTier) => void;
}) {
  const prices = useTierPrices(pincode);
  return (
    <Section title="Choose your tier">
      {prices.map(({ tier, query }, i) => {
        const fromPaise = fromPricePaise(query?.data);
        const price: PriceState =
          query === undefined || query.isPending
            ? { kind: 'loading' }
            : query.isError
              ? {
                  kind: 'error',
                  message: userMessage(query.error),
                  retry: () => void query.refetch(),
                }
              : fromPaise === null
                ? { kind: 'onRequest' }
                : { kind: 'ready', fromPaise };
        return (
          <Reveal key={tier} index={i}>
            <TierCard tier={tier} price={price} onPress={() => onSelect(tier)} />
          </Reveal>
        );
      })}
      <Reveal index={prices.length}>
        <TierCard
          tier="SIGNATURE"
          price={{ kind: 'onRequest' }}
          onPress={() => onSelect('SIGNATURE')}
        />
      </Reveal>
    </Section>
  );
}
