import { BottomSheet, Button, Chip, Text } from '@clickco/ui';
import { useState } from 'react';
import { View } from 'react-native';

/** Optional, one tap each. The API takes free text; these are the common answers. */
export const DECLINE_REASONS = ['Too far', 'Not available then', 'Not my category'] as const;

export interface DeclineSheetProps {
  readonly visible: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (reason: string | null) => void;
}

export function DeclineSheet({ visible, pending, error, onClose, onConfirm }: DeclineSheetProps) {
  const [reason, setReason] = useState<string | null>(null);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Decline this job?"
      testID="decline-sheet"
    >
      <View className="gap-5">
        <View className="gap-3">
          <Text tone="secondary">Pick a reason if you like. It is optional.</Text>
          <View className="flex-row flex-wrap gap-2">
            {DECLINE_REASONS.map((option) => (
              <Chip
                key={option}
                label={option}
                selected={reason === option}
                onPress={() => setReason((current) => (current === option ? null : option))}
              />
            ))}
          </View>
        </View>
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <View className="gap-3">
          <Button
            label="Decline job"
            variant="secondary"
            loading={pending}
            onPress={() => onConfirm(reason)}
            testID="decline-confirm"
          />
          <Button label="Keep this offer" variant="ghost" disabled={pending} onPress={onClose} />
        </View>
      </View>
    </BottomSheet>
  );
}
