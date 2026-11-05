import { Button, IconTile, Screen, Text } from '@clickco/ui';
import Check from 'lucide-react-native/icons/check';
import { View } from 'react-native';

export interface AccountDeletedViewProps {
  /** On to the signed-out start (sign-in). */
  readonly onContinue: () => void;
}

/** Shown once, right after a deletion, before the signed-out start (ADR-0030). */
export function AccountDeletedView({ onContinue }: AccountDeletedViewProps) {
  return (
    <Screen
      footer={<Button label="Done" onPress={onContinue} testID="account-deleted-done" />}
      testID="account-deleted"
    >
      <View className="items-center gap-5 pt-16" accessibilityLiveRegion="polite">
        <IconTile icon={Check} tone="success" size="lg" shape="circle" />
        <View className="items-center gap-3">
          <Text variant="display" align="center" accessibilityRole="header">
            Your account is deleted
          </Text>
          <Text tone="secondary" align="center">
            We've erased your details and signed you out on every device, and nothing of your
            account is left on this phone.
          </Text>
          <Text tone="secondary" align="center">
            If you sign up again with the same number, you'll start a new, empty account.
          </Text>
        </View>
      </View>
    </Screen>
  );
}
