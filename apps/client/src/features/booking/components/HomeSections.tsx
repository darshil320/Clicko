import type { PlanTier } from '@clickco/contracts';
import {
  Card,
  ErrorState,
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
import { screenState } from '@/shared/screen-state';
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
  /** The quote failed; the section's one error card says why and retries. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ready'; readonly fromPaise: number }
  | { readonly kind: 'onRequest' };

function TierPrice({ price }: { price: PriceState }) {
  switch (price.kind) {
    case 'loading':
      return <Skeleton className="h-7 w-full rounded-sm" />;
    case 'onRequest':
      return <Text variant="h3">On request</Text>;
    case 'unavailable':
      return (
        <Text variant="caption" tone="tertiary">
          Price unavailable right now
        </Text>
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

type TierQuery = ReturnType<typeof useTierPrices>[number]['query'];

interface FailedPrices {
  readonly offline: boolean;
  readonly message: string;
  readonly retrying: boolean;
  readonly retry: () => void;
}

/** One error card for the whole list (not one per tier), retrying every failed price. */
function failedPrices(queries: readonly TierQuery[]): FailedPrices | null {
  const failed = queries.flatMap((query) => {
    if (query === undefined) return [];
    const state = screenState(query);
    return state.kind === 'offline' || state.kind === 'error' ? [{ query, state }] : [];
  });
  const first = failed[0];
  if (!first) return null;
  return {
    offline: first.state.kind === 'offline',
    message: first.state.message,
    retrying: failed.some(({ state }) => state.retrying),
    retry: () => {
      for (const { query } of failed) void query.refetch();
    },
  };
}

function priceOf(query: TierQuery): PriceState {
  const state = query === undefined ? null : screenState(query);
  if (state === null || state.kind === 'loading') return { kind: 'loading' };
  if (state.kind === 'offline' || state.kind === 'error') return { kind: 'unavailable' };
  const fromPaise = fromPricePaise(state.data);
  return fromPaise === null ? { kind: 'onRequest' } : { kind: 'ready', fromPaise };
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
  const failed = failedPrices(prices.map(({ query }) => query));
  return (
    <Section title="Choose your tier">
      {failed ? (
        <ErrorState
          variant="card"
          offline={failed.offline}
          title="Prices didn't load"
          body={failed.message}
          retrying={failed.retrying}
          onRetry={failed.retry}
          testID="tier-prices-error"
        />
      ) : null}
      {prices.map(({ tier, query }, i) => (
        <Reveal key={tier} index={i}>
          <TierCard tier={tier} price={priceOf(query)} onPress={() => onSelect(tier)} />
        </Reveal>
      ))}
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
