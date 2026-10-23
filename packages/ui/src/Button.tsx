import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import {
  type ButtonSize,
  type ButtonVariant,
  buttonContainerClass,
  buttonLabelTone,
  buttonState,
} from './button.styles';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';
import { TONE_COLOR } from './tones';

export type { ButtonSize, ButtonVariant } from './button.styles';

export interface ButtonProps {
  readonly label: string;
  readonly onPress?: () => void;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  /** Busy: shows a spinner and ignores presses (prevents double submits). */
  readonly loading?: boolean;
  readonly icon?: LucideIcon;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

/** DESIGN.md §Components: primary / secondary / ghost × default / pressed / disabled / loading. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'default',
  disabled = false,
  loading = false,
  icon,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  const state = buttonState({ disabled, loading, pressed });
  const labelTone = buttonLabelTone(variant, state);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={buttonContainerClass(variant, state, size)}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={TONE_COLOR[labelTone]} />
      ) : icon ? (
        <View>
          <Icon icon={icon} tone={labelTone} />
        </View>
      ) : null}
      <Text variant="bodyStrong" tone={labelTone} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
