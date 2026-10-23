import { useState } from 'react';
import { Pressable } from 'react-native';
import { cx } from './cx';
import { Text } from './Text';

export interface ChipProps {
  readonly label: string;
  /** A second line (date pills: "Mon" over "14 Sep"). */
  readonly sublabel?: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** DESIGN.md §Components: pill, surface/raised; active = accent/subtle bg + accent text. */
export function Chip({
  label,
  sublabel,
  selected = false,
  disabled = false,
  onPress,
  accessibilityLabel,
  testID,
}: ChipProps) {
  const [pressed, setPressed] = useState(false);
  const surface = selected
    ? 'bg-accent-subtle border-accent-subtle'
    : pressed
      ? 'bg-surface-overlay border-border-strong'
      : 'bg-surface-raised border-border-subtle';
  const tone = disabled ? 'tertiary' : selected ? 'accent' : 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (sublabel ? `${label} ${sublabel}` : label)}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={cx(
        'min-h-tap min-w-tap items-center justify-center border px-4',
        sublabel ? 'rounded-lg py-2' : 'rounded-full',
        surface,
      )}
      testID={testID}
    >
      {sublabel ? (
        <Text variant="micro" tone={disabled ? 'tertiary' : selected ? 'accent' : 'secondary'}>
          {sublabel}
        </Text>
      ) : null}
      <Text variant={sublabel ? 'bodyStrong' : 'body'} tone={tone} tabular numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
