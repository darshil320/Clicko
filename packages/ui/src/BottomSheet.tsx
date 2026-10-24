import { layout, motion } from '@clickco/design-tokens';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import Animated, { Easing, ReduceMotion, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevationStyle } from './elevation';
import { EASE_OUT } from './motion';
import { Text } from './Text';

/** The scrim fades (Modal); the sheet rises from the bottom edge (240 ms, ease-out). */
const SHEET_ENTER = SlideInDown.duration(motion.revealMs)
  .easing(Easing.bezier(...EASE_OUT))
  .reduceMotion(ReduceMotion.System);

export interface BottomSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}

/**
 * White theme: surface/overlay with the `lg` shadow over an ink scrim, radius lg top corners,
 * a 44px drag handle. Tapping the scrim or Android back closes it.
 */
export function BottomSheet({ visible, onClose, title, children, testID }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          className="absolute inset-0 bg-text-primary/40"
        />
        <Animated.View entering={SHEET_ENTER}>
          <View
            accessibilityViewIsModal
            testID={testID}
            className="rounded-t-lg bg-surface-overlay px-5 pt-3"
            style={{
              ...elevationStyle('lg'),
              paddingBottom: insets.bottom + layout.ctaGapAboveInset,
            }}
          >
            <View className="mb-5 h-1 w-tap self-center rounded-full bg-border-strong" />
            {title ? (
              <Text variant="h2" className="mb-5" accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {children}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
