import { motion } from '@clickco/design-tokens';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  CHIP_BASE_CLASS,
  CHIP_SELECTED_OVERLAY_CLASS,
  chipBorderClass,
  chipLabelTone,
  chipRadiusClass,
  chipShapeClass,
  chipSublabelTone,
} from './chip.styles';
import { cx } from './cx';
import { elevationStyle } from './elevation';
import { EASE_OUT } from './motion';
import { Text } from './Text';
import { usePressFeedback } from './usePressFeedback';

const TIMING = { duration: motion.fastMs, easing: Easing.bezier(...EASE_OUT) };
const OVERLAY_FRAME = { ...StyleSheet.absoluteFill, pointerEvents: 'none' as const };

export interface ChipProps {
  readonly label: string;
  /** A second line (date pills: "Mon" over "14 Sep"). */
  readonly sublabel?: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/**
 * White theme: a white pill on a hairline. Selecting cross-fades in the amber tint with an ink
 * outline (160 ms; instant with reduced motion). Text stays dark — amber is never the text.
 */
export function Chip({
  label,
  sublabel,
  selected = false,
  disabled = false,
  onPress,
  accessibilityLabel,
  testID,
}: ChipProps) {
  const [pressed, setPressed] = useState(false);
  const feedback = usePressFeedback();
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(selected ? 1 : 0);
  const twoLine = sublabel !== undefined;

  useEffect(() => {
    const target = selected ? 1 : 0;
    shown.value = reduceMotion ? target : withTiming(target, TIMING);
  }, [selected, reduceMotion, shown]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: shown.value }));

  return (
    <Animated.View style={feedback.style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? (sublabel ? `${label} ${sublabel}` : label)}
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => {
          setPressed(true);
          feedback.onPressIn();
        }}
        onPressOut={() => {
          setPressed(false);
          feedback.onPressOut();
        }}
        className={cx(CHIP_BASE_CLASS, chipShapeClass(twoLine), chipBorderClass(selected, pressed))}
        style={elevationStyle('sm')}
        testID={testID}
      >
        <Animated.View style={[OVERLAY_FRAME, overlayStyle]}>
          <View className={cx(CHIP_SELECTED_OVERLAY_CLASS, chipRadiusClass(twoLine))} />
        </Animated.View>
        {sublabel ? (
          <Text variant="micro" tone={chipSublabelTone(selected, disabled)}>
            {sublabel}
          </Text>
        ) : null}
        <Text
          variant={twoLine ? 'bodyStrong' : 'body'}
          tone={chipLabelTone(selected, disabled)}
          tabular
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
