import type { PlanTier } from '@clickco/contracts';
import { View } from 'react-native';
import { cx } from './cx';
import { Text } from './Text';
import { TIER_LABEL, TIER_TONE } from './tones';

export interface TierBadgeProps {
  readonly tier: PlanTier;
}

/** DESIGN.md §Components: micro type, letter-spaced, tier-coloured — with a tier dot. */
export function TierBadge({ tier }: TierBadgeProps) {
  const style = TIER_TONE[tier];
  return (
    <View
      accessible
      accessibilityLabel={`${TIER_LABEL[tier]} tier`}
      className="flex-row items-center gap-2 self-start"
    >
      <View className={cx('h-2 w-2 rounded-full', style.dot)} />
      <Text variant="micro" tone={style.text}>
        {TIER_LABEL[tier]}
      </Text>
    </View>
  );
}
