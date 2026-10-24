import UserRound from 'lucide-react-native/icons/user-round';
import { Image, View } from 'react-native';
import { initials } from './avatar.logic';
import { cx } from './cx';
import { Icon } from './Icon';
import { Text } from './Text';

export type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Readonly<Record<AvatarSize, string>> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
};

export interface AvatarProps {
  readonly name: string;
  readonly uri?: string;
  readonly size?: AvatarSize;
}

/** Round, on the amber tint. Photo when available, else initials, else a person glyph. */
export function Avatar({ name, uri, size = 'md' }: AvatarProps) {
  const letters = initials(name);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      className={cx(
        'items-center justify-center overflow-hidden rounded-full bg-accent-subtle',
        SIZE_CLASS[size],
      )}
    >
      {uri ? (
        <Image source={{ uri }} className={cx('rounded-full', SIZE_CLASS[size])} />
      ) : letters ? (
        <Text variant={size === 'lg' ? 'h3' : 'caption'} tone="onAccent">
          {letters}
        </Text>
      ) : (
        <Icon icon={UserRound} tone="onAccent" />
      )}
    </View>
  );
}
