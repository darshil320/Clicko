# packages/ui — React Native primitives (client + pro)

The ten primitives from doc 01 §6: Button, Input, Card, StatusBadge, TierBadge, Chip, BottomSheet,
ListRow, EmptyState, Avatar — plus the S4 foundations every screen needs: Text, Icon, Skeleton,
Checkbox, Switch, Screen (added 23 Oct 2026, see docs/PROGRESS.md) — plus the white-theme set
(ADR-0017, 24 Oct 2026): IconTile, Section, SegmentedControl, Reveal, `elevationStyle`, `palette`.
- White theme (docs/DESIGN-LIGHT.md). The client app uses `lightTailwindPreset`; same class names.
- Tokens only, via NativeWind classes from the @clickco/design-tokens preset. Colour values that
  must be props (icon colour, placeholder, switch track) come from `palette` (= `colorLight`).
- Amber is a FILL with on-accent ink — there is no "accent" text/icon Tone on purpose.
- Shadows only through `elevationStyle(level)` (tokens → RN `boxShadow`); never raw values.
- Motion: `usePressFeedback`, `Reveal` (fade + 8px rise), chip/segment transitions — all from
  `motion` tokens via motion.ts, and every one honours reduced motion (Reanimated).
- Pure style/maths live in `*.styles.ts`, `motion.ts`, `elevation.ts`, `icon.sizes.ts` so Vitest
  can test them without React Native.
- Shipped as TypeScript source; the consuming Expo app's Babel/NativeWind transforms it.
- Minimum 44pt tap targets (`min-h-tap`). Every interactive primitive sets an accessibilityRole.
- Adding a primitive is a deliberate act — ask first.
