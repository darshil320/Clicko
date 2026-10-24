import { motion } from '@clickco/design-tokens';
import {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { EASE_OUT, PRESS_OPACITY, PRESS_SCALE } from './motion';

const TIMING = { duration: motion.fastMs, easing: Easing.bezier(...EASE_OUT) };
const SCALE_DROP = 1 - PRESS_SCALE;
const OPACITY_DROP = 1 - PRESS_OPACITY;

export interface PressFeedbackOptions {
  /** Rows inside a card only fade; surfaces that stand alone also shrink a little. */
  readonly scale?: boolean;
}

/**
 * Subtle, quick press feedback (DESIGN-LIGHT §Motion: 160 ms, ease-out). Apply `style` to a
 * Reanimated wrapper and the handlers to the Pressable. Reduced motion: no movement, and the
 * fade is instant.
 */
export function usePressFeedback({ scale = true }: PressFeedbackOptions = {}) {
  const reduceMotion = useReducedMotion();
  const shrink = scale && !reduceMotion;
  const pressed = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - pressed.value * OPACITY_DROP,
    transform: [{ scale: shrink ? 1 - pressed.value * SCALE_DROP : 1 }],
  }));
  const animateTo = (target: 0 | 1) => {
    pressed.value = reduceMotion ? target : withTiming(target, TIMING);
  };
  return { style, onPressIn: () => animateTo(1), onPressOut: () => animateTo(0) };
}
