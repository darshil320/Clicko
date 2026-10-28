import { colorLight } from '@clickco/design-tokens';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Clickco Pro — the photographer app (ADR-0024). Public configuration only: anything
 * EXPO_PUBLIC_* is inlined into the bundle, so it must never hold a secret.
 * EXPO_PUBLIC_API_URL defaults to the local API (see src/shared/config.ts).
 * Android emulator: EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 · a device: your machine's LAN IP.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Clickco Pro',
  slug: 'clickco-pro',
  scheme: 'clickcopro',
  version: '0.1.0',
  orientation: 'portrait',
  // White theme (ADR-0017, ADR-0024 D1).
  userInterfaceStyle: 'light',
  backgroundColor: colorLight.surface.base,
  ios: {
    bundleIdentifier: 'in.clickco.pro',
    supportsTablet: false,
  },
  android: {
    package: 'in.clickco.pro',
    // MMKV holds the session and the offline queue; keep both out of Android Auto Backup.
    allowBackup: false,
  },
  web: {
    bundler: 'metro',
    output: 'single',
    backgroundColor: colorLight.surface.base,
  },
  plugins: [
    'expo-router',
    [
      'expo-location',
      {
        // Foreground only: the fix is taken when the photographer taps check-in or check-out.
        locationWhenInUsePermission:
          'Clickco Pro checks your location when you check in and out of a shoot, to confirm you are at the venue.',
        isAndroidBackgroundLocationEnabled: false,
        isIosBackgroundLocationEnabled: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    tsconfigPaths: true,
  },
});
