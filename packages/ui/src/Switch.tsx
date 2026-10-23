import { color } from '@clickco/design-tokens';
import { Platform, Switch as RNSwitch } from 'react-native';

/** react-native-web paints the "on" thumb with its own default unless told otherwise. */
const WEB_PROPS = Platform.OS === 'web' ? { activeThumbColor: color.text.primary } : {};

export interface SwitchProps {
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** Platform switch, coloured from tokens: border/strong off, accent on. */
export function Switch({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
  testID,
}: SwitchProps) {
  return (
    <RNSwitch
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: color.border.strong, true: color.accent.default }}
      thumbColor={color.text.primary}
      ios_backgroundColor={color.border.strong}
      {...WEB_PROPS}
      testID={testID}
    />
  );
}
