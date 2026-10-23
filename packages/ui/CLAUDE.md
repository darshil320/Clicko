# packages/ui — React Native primitives (client + pro)

The ten primitives from doc 01 §6: Button, Input, Card, StatusBadge, TierBadge, Chip, BottomSheet,
ListRow, EmptyState, Avatar — plus the S4 foundations every screen needs: Text, Icon, Skeleton,
Checkbox, Switch, Screen (added 23 Oct 2026, see docs/PROGRESS.md).
- Tokens only, via NativeWind classes from the @clickco/design-tokens preset. Colour values that
  must be props (icon colour, placeholder, switch track) come from `color` in @clickco/design-tokens.
- Shipped as TypeScript source; the consuming Expo app's Babel/NativeWind transforms it.
- Minimum 44pt tap targets (`min-h-tap`). Every interactive primitive sets an accessibilityRole.
- Adding a primitive is a deliberate act — ask first.
