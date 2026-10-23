import { type ReactNode, useState } from 'react';
import { Pressable, View } from 'react-native';
import { cx } from './cx';
import { EDGE_CLASS, type EdgeTone } from './tones';

export type CardTone = 'default' | 'accent' | 'emergency' | 'warning';

const TONE_CLASS: Readonly<Record<CardTone, string>> = {
  default: 'bg-surface-raised border-border-subtle',
  accent: 'bg-accent-subtle border-accent-subtle',
  emergency: 'bg-surface-raised border-border-subtle',
  warning: 'bg-warning/15 border-warning/15',
};

export interface CardProps {
  readonly children: ReactNode;
  readonly tone?: CardTone;
  /** A thin coloured left edge (tier cards, the emergency banner). */
  readonly edge?: EdgeTone;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  /** Layout only (gap / direction). Colour and spacing come from the tone. */
  readonly className?: string;
  readonly testID?: string;
}

/** DESIGN.md §Components: surface/raised, 1px border/subtle, radius lg, padding 16. No shadow. */
export function Card({
  children,
  tone = 'default',
  edge,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  className,
  testID,
}: CardProps) {
  const [pressed, setPressed] = useState(false);
  const classes = cx(
    'rounded-lg border p-4',
    TONE_CLASS[tone],
    edge && `border-l-2 ${EDGE_CLASS[edge]}`,
    pressed && 'bg-surface-overlay',
    className,
  );

  if (!onPress) {
    return (
      <View className={classes} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={classes}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}
