import { Platform, Switch as RNSwitch } from 'react-native';
import { palette } from './palette';

/** react-native-web paints the "on" thumb with its own default unless told otherwise. */
const WEB_PROPS = Platform.OS === 'web' ? { activeThumbColor: palette.surface.base } : {};

export interface SwitchProps {
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** Platform switch, coloured from tokens: a white thumb on border/strong off, the amber fill on. */
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
      trackColor={{ false: palette.border.strong, true: palette.accent.default }}
      thumbColor={palette.surface.base}
      ios_backgroundColor={palette.border.strong}
      {...WEB_PROPS}
      testID={testID}
    />
  );
}
