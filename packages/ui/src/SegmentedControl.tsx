import { motion, space } from '@clickco/design-tokens';
import { useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { elevationStyle } from './elevation';
import { EASE_OUT } from './motion';
import { Text } from './Text';

/** The track's inner padding (p-1), mirrored as a number to place the sliding thumb. */
const INSET = space[1];
const TIMING = { duration: motion.revealMs, easing: Easing.bezier(...EASE_OUT) };
const THUMB_FRAME = { position: 'absolute', top: INSET, bottom: INSET, left: INSET } as const;

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly testID?: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly segments: readonly Segment<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/**
 * Two to four equal segments on a soft track; a white thumb with a soft shadow slides to the
 * selection (240 ms ease-out; instant with reduced motion). Tabs semantics for screen readers.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: SegmentedControlProps<T>) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const placed = useRef(false);
  const segmentWidth = Math.max(0, (width - INSET * 2) / Math.max(1, segments.length));
  const index = Math.max(
    0,
    segments.findIndex((segment) => segment.value === value),
  );
  const offset = useSharedValue(0);
  const thumbWidth = useSharedValue(0);

  useEffect(() => {
    if (segmentWidth === 0) return;
    const target = index * segmentWidth;
    thumbWidth.value = segmentWidth;
    // The first placement (and every change under reduced motion) is instant.
    offset.value = reduceMotion || !placed.current ? target : withTiming(target, TIMING);
    placed.current = true;
  }, [index, segmentWidth, reduceMotion, offset, thumbWidth]);

  const thumbStyle = useAnimatedStyle(() => ({
    width: thumbWidth.value,
    transform: [{ translateX: offset.value }],
  }));

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      className="flex-row rounded-full bg-border-subtle p-1"
      testID={testID}
    >
      {width > 0 ? (
        <Animated.View style={[THUMB_FRAME, thumbStyle]}>
          <View className="flex-1 rounded-full bg-surface-base" style={elevationStyle('sm')} />
        </Animated.View>
      ) : null}
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="tab"
            accessibilityLabel={segment.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(segment.value)}
            className="min-h-tap flex-1 items-center justify-center px-3"
            testID={segment.testID}
          >
            <Text
              variant={selected ? 'bodyStrong' : 'body'}
              tone={selected ? 'primary' : 'secondary'}
              tabular
              numberOfLines={1}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
