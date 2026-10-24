import Check from 'lucide-react-native/icons/check';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { cx } from './cx';
import { Icon } from './Icon';
import { Text } from './Text';
import { usePressFeedback } from './usePressFeedback';

export interface CheckboxProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Plain text, or a node for inline links. */
  readonly label: ReactNode;
  readonly accessibilityLabel: string;
  readonly error?: string;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** Opt-in control. Consents are never pre-ticked — callers own `checked` and start it false. */
export function Checkbox({
  checked,
  onChange,
  label,
  accessibilityLabel,
  error,
  disabled = false,
  testID,
}: CheckboxProps) {
  const feedback = usePressFeedback({ scale: false });
  return (
    <View className="gap-1">
      <Animated.View style={feedback.style}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ checked, disabled }}
          disabled={disabled}
          onPress={() => onChange(!checked)}
          onPressIn={feedback.onPressIn}
          onPressOut={feedback.onPressOut}
          className="min-h-tap flex-row items-center gap-3 py-2"
          testID={testID}
        >
          <View
            className={cx(
              'h-6 w-6 items-center justify-center rounded-sm border',
              checked
                ? 'border-accent-default bg-accent-default'
                : 'border-border-strong bg-surface-base',
              error && !checked && 'border-danger',
            )}
          >
            {checked ? <Icon icon={Check} tone="onAccent" size="small" /> : null}
          </View>
          <View className="flex-1">
            {typeof label === 'string' ? (
              <Text variant="body" tone={disabled ? 'tertiary' : 'primary'}>
                {label}
              </Text>
            ) : (
              label
            )}
          </View>
        </Pressable>
      </Animated.View>
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
