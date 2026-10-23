import type { PlanTier } from '@clickco/contracts';
import {
  Button,
  Card,
  Icon,
  type LucideIcon,
  Skeleton,
  Text,
  TIER_LABEL,
  TIER_TONE,
  TierBadge,
} from '@clickco/ui';
import Briefcase from 'lucide-react-native/icons/briefcase';
import Building from 'lucide-react-native/icons/building';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Heart from 'lucide-react-native/icons/heart';
import Package from 'lucide-react-native/icons/package';
import PartyPopper from 'lucide-react-native/icons/party-popper';
import UserRound from 'lucide-react-native/icons/user-round';
import UtensilsCrossed from 'lucide-react-native/icons/utensils-crossed';
import Zap from 'lucide-react-native/icons/zap';
import { ScrollView, View } from 'react-native';
import { CATEGORIES, TIER_COPY } from '@/shared/catalogue';
import { userMessage } from '@/shared/errors';
import { useTierPrices } from '../hooks';
import { fromPricePaise, rupees } from '../lib/quote-view';

const CATEGORY_ICON: Readonly<Record<string, LucideIcon>> = {
  FOOD: UtensilsCrossed,
  WEDDING: Heart,
  PORTRAIT: UserRound,
  PRODUCT: Package,
  EVENT: PartyPopper,
  REAL_ESTATE: Building,
  CORPORATE: Briefcase,
};

/** "Need a photographer today?" — emergency-red edge, the one place that colour is allowed. */
export function EmergencyBanner({ onPress }: { onPress: () => void }) {
  return (
    <Card
      tone="emergency"
      edge="emergency"
      onPress={onPress}
      accessibilityLabel="Need a photographer today? Book in the next 3 hours"
      testID="emergency-banner"
    >
      <View className="flex-row items-center gap-3">
        <Icon icon={Zap} tone="emergency" />
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

/** "Browse by need": six categories in a horizontal row (photography tiles pending real imagery). */
export function CategoryRow({ onSelect }: { onSelect: (categoryCode: string) => void }) {
  return (
    <View className="gap-3">
      <Text variant="h3" accessibilityRole="header">
        Browse by need
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3"
      >
        {CATEGORIES.slice(0, 6).map((category) => (
          <Card
            key={category.code}
            onPress={() => onSelect(category.code)}
            accessibilityLabel={`${category.label} photography`}
            className="min-w-tap items-center gap-2"
            testID={`category-${category.code}`}
          >
            <View className="h-14 w-14 items-center justify-center rounded-md bg-surface-overlay">
              <Icon icon={CATEGORY_ICON[category.code] ?? UserRound} tone="secondary" />
            </View>
            <Text variant="caption">{category.label}</Text>
          </Card>
        ))}
      </ScrollView>
    </View>
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
      return <Skeleton className="h-6 w-full rounded-sm" />;
    case 'onRequest':
      return <Text variant="bodyStrong">On request</Text>;
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
        <Text variant="bodyStrong" tabular>
          from {rupees(price.fromPaise)} / 2 hrs{' '}
          <Text variant="caption" tone="tertiary">
            + GST
          </Text>
        </Text>
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
      edge={TIER_TONE[tier].edge}
      onPress={onPress}
      accessibilityLabel={`${TIER_LABEL[tier]} plan, ${TIER_COPY[tier].tagline}`}
      testID={`tier-${tier}`}
    >
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-2">
          <TierBadge tier={tier} />
          <Text tone="secondary">{TIER_COPY[tier].tagline}</Text>
          <TierPrice price={price} />
        </View>
        <Icon icon={ChevronRight} tone="tertiary" />
      </View>
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
    <View className="gap-3">
      <Text variant="h3" accessibilityRole="header">
        Choose your tier
      </Text>
      {prices.map(({ tier, query }) => {
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
        return <TierCard key={tier} tier={tier} price={price} onPress={() => onSelect(tier)} />;
      })}
      <TierCard
        tier="SIGNATURE"
        price={{ kind: 'onRequest' }}
        onPress={() => onSelect('SIGNATURE')}
      />
    </View>
  );
}
