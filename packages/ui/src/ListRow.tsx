import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { type ReactNode, useState } from 'react';
import { Pressable, View } from 'react-native';
import { cx } from './cx';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';
import type { Tone } from './tones';

export interface ListRowProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Right-aligned value, e.g. an amount. Rendered with tabular numerals. */
  readonly value?: string;
  readonly valueTone?: Tone;
  readonly emphasis?: boolean;
  readonly icon?: LucideIcon;
  readonly iconTone?: Tone;
  /** "chevron" for navigation, or any trailing control (a Switch). */
  readonly accessory?: 'chevron' | ReactNode;
  readonly onPress?: () => void;
  readonly divider?: boolean;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** A single row: optional icon, title + subtitle, trailing value or control. Min 44pt tall. */
export function ListRow({
  title,
  subtitle,
  value,
  valueTone = 'primary',
  emphasis = false,
  icon,
  iconTone = 'secondary',
  accessory,
  onPress,
  divider = false,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const [pressed, setPressed] = useState(false);
  const content = (
    <>
      {icon ? <Icon icon={icon} tone={iconTone} /> : null}
      <View className="flex-1 gap-1">
        <Text variant={emphasis ? 'bodyStrong' : 'body'}>{title}</Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant={emphasis ? 'bodyStrong' : 'body'} tone={valueTone} tabular>
          {value}
        </Text>
      ) : null}
      {accessory === 'chevron' ? <Icon icon={ChevronRight} tone="tertiary" /> : (accessory ?? null)}
    </>
  );
  const classes = cx(
    'min-h-tap flex-row items-center gap-3 py-3',
    divider && 'border-b border-border-subtle',
    pressed && 'bg-surface-overlay',
  );

  if (!onPress) {
    return (
      <View className={classes} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ')}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={classes}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}
