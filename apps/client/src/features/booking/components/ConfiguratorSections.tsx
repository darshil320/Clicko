import type { AddonCode, PlanTier } from '@clickco/contracts';
import { layout } from '@clickco/design-tokens';
import { Button, Chip, ListRow, Skeleton, Switch, Text, TIER_LABEL } from '@clickco/ui';
import { type ReactNode, useRef } from 'react';
import { type LayoutChangeEvent, ScrollView, View } from 'react-native';
import { BOOKABLE_TIERS, type BookableTier, CATEGORIES, eligibleAddons } from '@/shared/catalogue';
import { formatHours, formatTime } from '@/shared/format/datetime';
import { canDecrease, canIncrease, MIN_HOURS } from '../lib/duration';
import { rupees } from '../lib/quote-view';
import type { DatePill } from '../lib/schedule';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <Text variant="bodyStrong" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

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
      contentContainerClassName="gap-2"
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
    <View className="flex-row items-center gap-3">
      <Button
        label="−"
        variant="secondary"
        size="compact"
        disabled={!canDecrease(hours)}
        onPress={() => onStep(-1)}
        accessibilityLabel="Half an hour shorter"
        testID="hours-decrease"
      />
      <View className="flex-1 items-center">
        <Text variant="h3" tabular accessibilityLiveRegion="polite" testID="hours-value">
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

export function AddonList({
  tier,
  selected,
  prices,
  pricesLoading,
  onToggle,
}: {
  tier: PlanTier;
  selected: readonly AddonCode[];
  prices: Partial<Record<AddonCode, number>>;
  pricesLoading: boolean;
  onToggle: (code: AddonCode) => void;
}) {
  const addons = eligibleAddons(tier);
  if (addons.length === 0) {
    return (
      <Text variant="caption" tone="tertiary">
        Add-ons start from the Semi-Pro tier.
      </Text>
    );
  }
  return (
    <View>
      {addons.map((addon, i) => {
        const price = prices[addon.code];
        const on = selected.includes(addon.code);
        return (
          <ListRow
            key={addon.code}
            title={addon.label}
            subtitle={[price === undefined ? null : `+${rupees(price)}`, addon.note]
              .filter(Boolean)
              .join(' · ')}
            divider={i < addons.length - 1}
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
      })}
    </View>
  );
}
