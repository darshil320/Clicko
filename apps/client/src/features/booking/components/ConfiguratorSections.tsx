import type { AddonCode, PlanTier } from '@clickco/contracts';
import { layout } from '@clickco/design-tokens';
import { Button, Chip, ListRow, Skeleton, Switch, Text, TIER_LABEL } from '@clickco/ui';
import { type ReactNode, useRef } from 'react';
import { type LayoutChangeEvent, ScrollView, View } from 'react-native';
import {
  type AddonInfo,
  addonsUnder,
  BOOKABLE_TIERS,
  type BookableTier,
  CATEGORIES,
  topLevelAddons,
} from '@/shared/catalogue';
import { formatHours, formatTime } from '@/shared/format/datetime';
import { canDecrease, canIncrease, MIN_HOURS } from '../lib/duration';
import { rupees } from '../lib/quote-view';
import type { DatePill } from '../lib/schedule';

/**
 * A horizontal pill row that brings the selected pill into view the first time it lays out
 * (a default slot such as 11:00 am would otherwise sit off-screen).
 */
function PillRow<T extends string | number>({
  items,
  selected,
  render,
}: {
  items: readonly T[];
  selected: T;
  render: (item: T) => ReactNode;
}) {
  const scroll = useRef<ScrollView>(null);
  const scrolled = useRef(false);
  const reveal = (event: LayoutChangeEvent) => {
    if (scrolled.current) return;
    scrolled.current = true;
    const x = Math.max(0, event.nativeEvent.layout.x - layout.screenPaddingX);
    scroll.current?.scrollTo({ x, animated: false });
  };
  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-5"
      contentContainerClassName="gap-2 px-5 py-1"
    >
      {items.map((item) => (
        <View key={item} onLayout={item === selected ? reveal : undefined}>
          {render(item)}
        </View>
      ))}
    </ScrollView>
  );
}

export function DatePills({
  pills,
  selected,
  onSelect,
}: {
  pills: readonly DatePill[];
  selected: string;
  onSelect: (dateKey: string) => void;
}) {
  const byKey = new Map(pills.map((pill) => [pill.dateKey, pill]));
  return (
    <PillRow
      items={pills.map((pill) => pill.dateKey)}
      selected={selected}
      render={(dateKey) => {
        const pill = byKey.get(dateKey);
        return pill ? (
          <Chip
            sublabel={pill.weekday}
            label={pill.label}
            selected={dateKey === selected}
            onPress={() => onSelect(dateKey)}
            accessibilityLabel={`${pill.weekday} ${pill.label}`}
            testID={`date-${dateKey}`}
          />
        ) : null;
      }}
    />
  );
}

export function TimePills({
  slots,
  selected,
  onSelect,
}: {
  slots: readonly number[];
  selected: number;
  onSelect: (minute: number) => void;
}) {
  if (slots.length === 0) {
    return (
      <Text tone="secondary" variant="caption">
        No start times left on this day — pick another date.
      </Text>
    );
  }
  return (
    <PillRow
      items={slots}
      selected={selected}
      render={(minute) => (
        <Chip
          label={formatTime(minute)}
          selected={minute === selected}
          onPress={() => onSelect(minute)}
          testID={`time-${minute}`}
        />
      )}
    />
  );
}

export function DurationStepper({
  hours,
  onStep,
}: {
  hours: number;
  onStep: (direction: 1 | -1) => void;
}) {
  return (
    <View className="flex-row items-center gap-4">
      <Button
        label="−"
        variant="secondary"
        size="compact"
        disabled={!canDecrease(hours)}
        onPress={() => onStep(-1)}
        accessibilityLabel="Half an hour shorter"
        testID="hours-decrease"
      />
      <View className="flex-1 items-center gap-1">
        <Text variant="h2" tabular accessibilityLiveRegion="polite" testID="hours-value">
          {formatHours(hours)}
        </Text>
        <Text variant="caption" tone="tertiary">
          Minimum {formatHours(MIN_HOURS)}, in 30-minute steps
        </Text>
      </View>
      <Button
        label="+"
        variant="secondary"
        size="compact"
        disabled={!canIncrease(hours)}
        onPress={() => onStep(1)}
        accessibilityLabel="Half an hour longer"
        testID="hours-increase"
      />
    </View>
  );
}

export function TierChips({
  selected,
  onSelect,
}: {
  selected: BookableTier;
  onSelect: (tier: BookableTier) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {BOOKABLE_TIERS.map((tier) => (
        <Chip
          key={tier}
          label={TIER_LABEL[tier]}
          selected={tier === selected}
          onPress={() => onSelect(tier)}
          testID={`plan-${tier}`}
        />
      ))}
    </View>
  );
}

export function CategoryChips({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (code: string) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {CATEGORIES.map((category) => (
        <Chip
          key={category.code}
          label={category.label}
          selected={category.code === selected}
          onPress={() => onSelect(category.code)}
          testID={`chip-${category.code}`}
        />
      ))}
    </View>
  );
}

type AddonPrices = Partial<Record<AddonCode, number>>;

function priceSubtitle(addon: AddonInfo, price: number | undefined): string {
  return [price === undefined ? null : `+${rupees(price)}`, addon.note].filter(Boolean).join(' · ');
}

function SwitchRow({
  addon,
  on,
  price,
  pricesLoading,
  divider,
  onToggle,
}: {
  addon: AddonInfo;
  on: boolean;
  price: number | undefined;
  pricesLoading: boolean;
  divider: boolean;
  onToggle: (code: AddonCode) => void;
}) {
  return (
    <ListRow
      title={addon.label}
      subtitle={priceSubtitle(addon, price)}
      divider={divider}
      accessory={
        <View className="flex-row items-center gap-3">
          {pricesLoading && price === undefined ? <Skeleton className="h-4 w-14" /> : null}
          <Switch
            value={on}
            onValueChange={() => onToggle(addon.code)}
            accessibilityLabel={`${addon.label}${price === undefined ? '' : `, plus ${rupees(price)}`}`}
            testID={`addon-${addon.code}`}
          />
        </View>
      }
    />
  );
}

/**
 * Reels are a count (ADR-0034). The price shown is the server's for the count picked (the probe
 * asks for it), so the 5-or-more rate shows without the app knowing it.
 */
function CountRow({
  addon,
  count,
  price,
  divider,
  onCount,
}: {
  addon: AddonInfo;
  count: number;
  price: number | undefined;
  divider: boolean;
  onCount: (count: number) => void;
}) {
  const max = addon.maxCount ?? 1;
  // At 0 the probe priced one unit: say so, rather than "+₹3,000" for nothing ordered.
  const subtitle =
    count === 0 && price !== undefined
      ? [`${rupees(price)} each`, addon.note].filter(Boolean).join(' · ')
      : priceSubtitle(addon, price);
  return (
    <ListRow
      title={addon.label}
      subtitle={subtitle}
      divider={divider}
      accessory={
        <View className="flex-row items-center gap-2">
          <Button
            label="−"
            variant="secondary"
            size="compact"
            disabled={count <= 0}
            onPress={() => onCount(count - 1)}
            accessibilityLabel={`${addon.label}: one fewer`}
            testID={`addon-${addon.code}-decrease`}
          />
          <Text
            variant="bodyStrong"
            tabular
            accessibilityLiveRegion="polite"
            testID={`addon-${addon.code}-count`}
          >
            {count}
          </Text>
          <Button
            label="+"
            variant="secondary"
            size="compact"
            disabled={count >= max}
            onPress={() => onCount(count + 1)}
            accessibilityLabel={`${addon.label}: one more`}
            testID={`addon-${addon.code}-increase`}
          />
        </View>
      }
    />
  );
}

/** Top-level add-ons, each followed (once on) by what hangs off it: reels and raw footage. */
function visibleAddons(tier: PlanTier, selected: readonly AddonCode[]): readonly AddonInfo[] {
  return topLevelAddons(tier).flatMap((addon) =>
    selected.includes(addon.code) ? [addon, ...addonsUnder(tier, addon.code)] : [addon],
  );
}

export function AddonList({
  tier,
  selected,
  reels,
  prices,
  pricesLoading,
  onToggle,
  onReels,
}: {
  tier: PlanTier;
  selected: readonly AddonCode[];
  reels: number;
  prices: AddonPrices;
  pricesLoading: boolean;
  onToggle: (code: AddonCode) => void;
  onReels: (count: number) => void;
}) {
  const addons = visibleAddons(tier, selected);
  return (
    <View>
      {addons.map((addon, i) => {
        const divider = i < addons.length - 1;
        const price = prices[addon.code];
        return addon.maxCount === undefined ? (
          <SwitchRow
            key={addon.code}
            addon={addon}
            on={selected.includes(addon.code)}
            price={price}
            pricesLoading={pricesLoading}
            divider={divider}
            onToggle={onToggle}
          />
        ) : (
          <CountRow
            key={addon.code}
            addon={addon}
            count={reels}
            price={price}
            divider={divider}
            onCount={onReels}
          />
        );
      })}
    </View>
  );
}
