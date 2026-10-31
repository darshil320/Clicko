import { Button, Icon, Text } from '@clickco/ui';
import Timer from 'lucide-react-native/icons/timer';
import { View } from 'react-native';
import { useNow } from '@/shared/hooks/useNow';
import { formatCountdown, isUrgent, secondsLeft, spokenCountdown } from '../lib/countdown';

const TICK_MS = 1000;

/** Seconds left on an offer, re-rendering only the component that calls it, once a second. */
function useSecondsLeft(expiresAt: string): number {
  return secondsLeft(expiresAt, useNow(TICK_MS));
}

/** The card's "Accept in 1:24" line: the only part of the feed that ticks every second. */
export function OfferCountdown({ expiresAt }: { readonly expiresAt: string }) {
  const seconds = useSecondsLeft(expiresAt);
  const tone = isUrgent(seconds) ? 'warning' : 'primary';
  return (
    <View className="flex-row items-center gap-2">
      <Icon icon={Timer} size="small" tone={tone} />
      <Text variant="bodyStrong" tone={tone} tabular>
        Accept in {formatCountdown(seconds)}
      </Text>
    </View>
  );
}

export interface AcceptButtonProps {
  readonly expiresAt: string;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

/** "Accept · 1:24": the detail screen's ticking button, so the screen around it stays still. */
export function AcceptButton({ expiresAt, loading, disabled, onPress }: AcceptButtonProps) {
  const seconds = useSecondsLeft(expiresAt);
  return (
    <Button
      label={`Accept · ${formatCountdown(seconds)}`}
      accessibilityLabel={`Accept job, ${spokenCountdown(seconds)} left`}
      loading={loading}
      disabled={disabled}
      onPress={onPress}
      testID="accept-offer"
    />
  );
}
