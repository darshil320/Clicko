# apps/pro — Clickco Pro (photographers) · Expo SDK 56 · RN 0.85 · React 19.2 · expo-router 56.2

Design: ADR-0024 (screens, offline queue, mocked GPS), white theme (ADR-0017). Load the `clickco-screen` skill for any screen.
- `app/` routes compose only; logic lives in `src/features/<feature>/` (api.ts → hooks.ts → components/, pure logic in lib/ with Vitest tests).
- features/X never imports features/Y. Shared code → `src/shared/` (import as `@/shared/...`) or packages/. Inside a feature use relative imports; routes import features via their `index.ts`.
- Server state: TanStack Query. Client state: Zustand (persisted through `src/shared/storage/kv.ts`, MMKV). Never Redux, never AsyncStorage.
- Styling: NativeWind with the @clickco/design-tokens light preset only. Primitives from @clickco/ui only.
- Icons: import one at a time — `import Timer from 'lucide-react-native/icons/timer'`.
- API calls only through `createProApiClient` (`src/shared/api.ts`).
- **On-site actions** (en-route, check-in, start, extension, waiting, incidents, client-absent, check-out) go ONLY through `performOnsite` (`src/shared/offline/runner.ts`): it sends now, or queues offline with `deviceTs` and a fixed Idempotency-Key. Never call `api.onsite.*` from a feature.
- Location only through `currentFix()` (`src/shared/location/current-fix.ts`); the 150 m decision is the server's.
- Never persist a venue address. Never `newArchEnabled: false`. Nothing secret in `EXPO_PUBLIC_*`.

## Run

```
pnpm --filter @clickco/pro build:deps   # builds contracts/utils/tokens/api-client dist
pnpm --filter @clickco/pro web          # http://localhost:8082 (API CORS must allow it)
pnpm --filter @clickco/pro ios|android  # dev build via expo run:* — MMKV/Nitro/expo-location are native
```
`EXPO_PUBLIC_API_URL` defaults to http://localhost:4000 (Android emulator: http://10.0.2.2:4000).
Dev sign-in: a seeded photographer, e.g. +919999000101, then "Fill dev OTP".
