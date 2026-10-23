# apps/client — Expo SDK 56 · RN 0.85 · React 19.2 · expo-router 56.2

Load the `clickco-screen` skill for any screen.
- `app/` routes compose only; logic lives in `src/features/<feature>/` (api.ts → hooks.ts → components/, pure logic in lib/ with Vitest tests).
- features/X never imports features/Y. Shared code → `src/shared/` (import as `@/shared/...`) or packages/. Inside a feature use relative imports (`../hooks`); routes import features via their `index.ts`.
- Server state: TanStack Query. Client state: Zustand (persisted through `src/shared/storage/kv.ts`, MMKV). Never Redux, never AsyncStorage.
- Styling: NativeWind with the @clickco/design-tokens preset only. Primitives from @clickco/ui only.
- Icons: import one at a time — `import Zap from 'lucide-react-native/icons/zap'`. The package barrel bundles ~1,900 icons.
- API calls only through `@clickco/api-client` (`src/shared/api.ts`). Money-mutating calls take an Idempotency-Key from the feature store.
- Never `newArchEnabled: false`. Nothing secret in `EXPO_PUBLIC_*`.

## Run

```
pnpm --filter @clickco/client build:deps   # builds contracts/utils/tokens/api-client dist
pnpm --filter @clickco/client web          # http://localhost:8081 (API CORS must allow it)
pnpm --filter @clickco/client ios|android  # dev build via expo run:* — MMKV/Nitro are native, Expo Go cannot run them
```
`EXPO_PUBLIC_API_URL` defaults to http://localhost:4000 (Android emulator: http://10.0.2.2:4000).
