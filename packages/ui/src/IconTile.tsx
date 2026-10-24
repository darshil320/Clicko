import { View } from 'react-native';
import { cx } from './cx';
import { Icon, type LucideIcon } from './Icon';
import {
  type IconTileShape,
  type IconTileSize,
  type IconTileTone,
  TILE_ICON_SIZE,
  TILE_SIZE_CLASS,
  TILE_TONE,
  tileShapeClass,
} from './tile.styles';

export type { IconTileShape, IconTileSize, IconTileTone } from './tile.styles';

export interface IconTileProps {
  readonly icon: LucideIcon;
  readonly tone?: IconTileTone;
  readonly size?: IconTileSize;
  readonly shape?: IconTileShape;
  /** Decorative by default; pass a label when the tile alone carries meaning. */
  readonly accessibilityLabel?: string;
}

/** An icon on a soft tile — categories, banners, empty states, timeline steps, the success mark. */
export function IconTile({
  icon,
  tone = 'neutral',
  size = 'md',
  shape = 'rounded',
  accessibilityLabel,
}: IconTileProps) {
  const style = TILE_TONE[tone];
  return (
    <View
      accessible={accessibilityLabel !== undefined}
      accessibilityRole={accessibilityLabel === undefined ? undefined : 'image'}
      accessibilityLabel={accessibilityLabel}
      className={cx(
        'items-center justify-center',
        TILE_SIZE_CLASS[size],
        tileShapeClass(size, shape),
        style.surface,
      )}
    >
      <Icon icon={icon} tone={style.icon} size={TILE_ICON_SIZE[size]} />
    </View>
  );
}
