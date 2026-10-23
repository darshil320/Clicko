import { useEffect, useRef } from 'react';
import { Animated, Platform, View } from 'react-native';
import { cx } from './cx';

const PULSE_MS = 900;
const DIM = 0.45;

export interface SkeletonProps {
  /** Size and shape, e.g. "h-6 w-32" or "h-24 w-full rounded-lg". */
  readonly className?: string;
}

/** Loading placeholder — screens show skeletons, never spinners (clickco-screen §6). */
export function Skeleton({ className }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const useNativeDriver = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: DIM, duration: PULSE_MS, useNativeDriver }),
        Animated.timing(opacity, { toValue: 1, duration: PULSE_MS, useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ opacity }}
    >
      {/* className lives on a plain View: NativeWind maps classes on core components only. */}
      <View className={cx('rounded-md bg-surface-overlay', className)} />
    </Animated.View>
  );
}
