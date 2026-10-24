import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  CARD_BASE_CLASS,
  CARD_ELEVATION,
  CARD_PADDING_CLASS,
  CARD_TONE_CLASS,
  type CardPadding,
  type CardTone,
} from './card.styles';
import { cx } from './cx';
import { elevationStyle } from './elevation';
import { EDGE_CLASS, type EdgeTone } from './tones';
import { usePressFeedback } from './usePressFeedback';

export type { CardPadding, CardTone } from './card.styles';

export interface CardProps {
  readonly children: ReactNode;
  readonly tone?: CardTone;
  /** 20 inside by default; "compact" (12) for small tiles; "list" for a stack of ListRows. */
  readonly padding?: CardPadding;
  /** A thin coloured left edge. */
  readonly edge?: EdgeTone;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  /** Layout only (gap / direction / width). Colour and spacing come from the tone. */
  readonly className?: string;
  readonly testID?: string;
}

/**
 * White theme (DESIGN-LIGHT): surface/raised, 1px border/subtle, radius lg, a soft `sm` shadow.
 * Tinted tones sit flat. Pressable cards shrink 2% on press.
 */
export function Card({
  children,
  tone = 'default',
  padding = 'default',
  edge,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  className,
  testID,
}: CardProps) {
  const feedback = usePressFeedback();
  const classes = cx(
    CARD_BASE_CLASS,
    CARD_PADDING_CLASS[padding],
    CARD_TONE_CLASS[tone],
    edge && `border-l-2 ${EDGE_CLASS[edge]}`,
    className,
  );
  const shadow = elevationStyle(CARD_ELEVATION[tone]);

  if (!onPress) {
    return (
      <View className={classes} style={shadow} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Animated.View style={feedback.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        onPressIn={feedback.onPressIn}
        onPressOut={feedback.onPressOut}
        className={classes}
        style={shadow}
        testID={testID}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
