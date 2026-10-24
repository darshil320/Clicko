import { motion } from '@clickco/design-tokens';
import { type ReactNode, useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { EASE_OUT, revealDelay } from './motion';

const EASE = Easing.bezier(...EASE_OUT);
const RISE_PX = motion.revealRisePx;
const DURATION_MS = motion.revealMs;

export interface RevealProps {
  readonly children: ReactNode;
  /** Position in a list: each step starts 40 ms later, capped (motion.ts). */
  readonly index?: number;
  /** Layout classes for the content, e.g. "gap-6". Colour comes from the children. */
  readonly className?: string;
  readonly testID?: string;
}

/**
 * Entrance: fade in and rise 8px over 240 ms ease-out, once, on mount (DESIGN-LIGHT §Motion,
 * after Magic UI's Blur Fade). Reduced motion: shown at once, no movement.
 */
export function Reveal({ children, index = 0, className, testID }: RevealProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    progress.value = reduceMotion
      ? 1
      : withDelay(revealDelay(index), withTiming(1, { duration: DURATION_MS, easing: EASE }));
  }, [index, progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * RISE_PX }],
  }));

  return (
    <Animated.View style={style} testID={testID}>
      {className ? <View className={className}>{children}</View> : children}
    </Animated.View>
  );
}
