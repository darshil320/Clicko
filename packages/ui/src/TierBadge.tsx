import type { PlanTier } from '@clickco/contracts';
import { View } from 'react-native';
import { Text } from './Text';
import { TIER_LABEL, TIER_TONE } from './tones';

export interface TierBadgeProps {
  readonly tier: PlanTier;
}

/** DESIGN.md §Components: micro type, letter-spaced, tier-coloured. */
export function TierBadge({ tier }: TierBadgeProps) {
  return (
    <View accessible accessibilityLabel={`${TIER_LABEL[tier]} tier`} className="self-start">
      <Text variant="micro" tone={TIER_TONE[tier].text}>
        {TIER_LABEL[tier]}
      </Text>
    </View>
  );
}
