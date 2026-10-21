# apps/pro — Expo SDK 56 · RN 0.85 · React 19.2

Not scaffolded yet — generated in its own sprint (see docs/PLAN.md §2). Load the `clickco-screen` skill for any screen.
- `app/` routes compose only; logic lives in `src/features/<feature>/`.
- features/X never imports features/Y. Shared code → `src/shared/` or packages/.
- Server state: TanStack Query. Client state: Zustand. Storage: MMKV. Never Redux, never AsyncStorage.
- Styling: NativeWind with the @clickco/design-tokens preset only. Primitives from @clickco/ui only.
- Never `newArchEnabled: false`. Nothing secret in `EXPO_PUBLIC_*`.
