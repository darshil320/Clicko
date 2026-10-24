import { View } from 'react-native';
import { cx } from './cx';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';
import { BADGE_TONE_CLASS, type BadgeTone } from './tones';

export type { BadgeTone } from './tones';

export interface StatusBadgeProps {
  readonly label: string;
  readonly tone?: BadgeTone;
  /** Meaning is never colour alone — the label always carries it. An icon replaces the dot. */
  readonly icon?: LucideIcon;
}

/** A pill with a status dot and micro label (DESIGN.md §Components, white theme). */
export function StatusBadge({ label, tone = 'neutral', icon }: StatusBadgeProps) {
  const style = BADGE_TONE_CLASS[tone];
  return (
    <View
      accessible
      accessibilityLabel={label}
      className={cx(
        'flex-row items-center gap-2 self-start rounded-full border px-3 py-1',
        style.surface,
      )}
    >
      {icon ? (
        <Icon icon={icon} tone={style.text} size="small" />
      ) : (
        <View className={cx('h-2 w-2 rounded-full', style.dot)} />
      )}
      <Text variant="micro" tone={style.text}>
        {label}
      </Text>
    </View>
  );
}
