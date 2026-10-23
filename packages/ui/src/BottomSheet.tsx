import { layout } from '@clickco/design-tokens';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';

export interface BottomSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}

/**
 * DESIGN.md §Components: surface/overlay, radius lg top corners, 44px drag handle.
 * Simple v0: a modal that slides up; tapping the backdrop or Android back closes it.
 */
export function BottomSheet({ visible, onClose, title, children, testID }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          className="absolute inset-0 bg-surface-base/80"
        />
        <View
          accessibilityViewIsModal
          testID={testID}
          className="rounded-t-lg border border-border-subtle bg-surface-overlay px-5 pt-3"
          style={{ paddingBottom: insets.bottom + layout.ctaGapAboveInset }}
        >
          <View className="mb-4 h-1 w-tap self-center rounded-full bg-border-strong" />
          {title ? (
            <Text variant="h3" className="mb-4" accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
