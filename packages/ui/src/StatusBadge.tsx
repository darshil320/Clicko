import { View } from 'react-native';
import { cx } from './cx';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';
import { BADGE_TONE_CLASS, type BadgeTone } from './tones';

export type { BadgeTone } from './tones';

export interface StatusBadgeProps {
  readonly label: string;
  readonly tone?: BadgeTone;
  /** Meaning is never colour alone — the label always carries it; an icon is optional. */
  readonly icon?: LucideIcon;
}

/** DESIGN.md §Components: pill, micro type, tinted background + matching text colour. */
export function StatusBadge({ label, tone = 'neutral', icon }: StatusBadgeProps) {
  const style = BADGE_TONE_CLASS[tone];
  return (
    <View
      accessible
      accessibilityLabel={label}
      className={cx('flex-row items-center gap-1 self-start rounded-full px-2 py-1', style.bg)}
    >
      {icon ? <Icon icon={icon} tone={style.text} /> : null}
      <Text variant="micro" tone={style.text}>
        {label}
      </Text>
    </View>
  );
}
