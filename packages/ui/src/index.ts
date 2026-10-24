// The ten primitives from doc 01 §6.
export { Avatar, type AvatarProps, type AvatarSize } from './Avatar';
export { initials } from './avatar.logic';
export { BottomSheet, type BottomSheetProps } from './BottomSheet';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Card, type CardPadding, type CardProps, type CardTone } from './Card';
// S4 foundations (see CLAUDE.md).
export { Checkbox, type CheckboxProps } from './Checkbox';
export { Chip, type ChipProps } from './Chip';
export { cx } from './cx';
export { EmptyState, type EmptyStateProps } from './EmptyState';
// White theme (ADR-0017): elevation, motion and the light palette.
export { type ElevationLevel, type ElevationStyle, elevationStyle } from './elevation';
export { FONT_FACES, fontFaceFor } from './fonts';
export { Icon, type IconProps, type IconSize, type LucideIcon } from './Icon';
export {
  IconTile,
  type IconTileProps,
  type IconTileShape,
  type IconTileSize,
  type IconTileTone,
} from './IconTile';
export { Input, type InputProps } from './Input';
export { ListRow, type ListRowProps } from './ListRow';
export { palette } from './palette';
export { Reveal, type RevealProps } from './Reveal';
export { Screen, type ScreenProps } from './Screen';
export { Section, type SectionProps } from './Section';
export { type Segment, SegmentedControl, type SegmentedControlProps } from './SegmentedControl';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { type BadgeTone, StatusBadge, type StatusBadgeProps } from './StatusBadge';
export { Switch, type SwitchProps } from './Switch';
export { Text, type TextProps, type TextVariant } from './Text';
export { TierBadge, type TierBadgeProps } from './TierBadge';
export { type EdgeTone, TIER_LABEL, TIER_TONE, type Tone } from './tones';
