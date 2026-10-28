import { colorLight } from '@clickco/design-tokens';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Clickco Pro — the photographer app (ADR-0024). Public configuration only: anything
 * EXPO_PUBLIC_* is inlined into the bundle, so it must never hold a secret.
 * EXPO_PUBLIC_API_URL defaults to the local API (see src/shared/config.ts).
 * Android emulator: EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 · a device: your machine's LAN IP.
 */
/**
 * Store builds (EAS profile "production") must talk to Clickco over https: the defaults in
 * src/shared/config.ts are localhost for development only (security review L5).
 */
function assertReleaseUrls(): void {
  if (process.env.EAS_BUILD_PROFILE !== 'production') return;
  for (const name of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_UPLOAD_PORTAL_URL']) {
    const value = process.env[name];
    if (!value?.startsWith('https://')) {
      throw new Error(`${name} must be an https URL for a production build`);
    }
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  assertReleaseUrls();
  return appConfig(config);
};

const appConfig = (config: ConfigContext['config']): ExpoConfig => ({
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
      'expo-secure-store',
      {
        // The MMKV key is read without biometrics: no Face ID usage string (ADR-0025 D7).
        faceIDPermission: false,
        // Default, kept explicit: backup and device-transfer rules carry shared preferences only,
        // never SecureStore's entries or the MMKV files (session and offline queue).
        configureAndroidBackup: true,
      },
    ],
    [
      'expo-location',
      {
        // Foreground only: the fix is taken when the photographer taps check-in or check-out.
        locationWhenInUsePermission:
          'Clickco Pro checks your location when you check in and out of a shoot, to confirm you are at the venue.',
        // Never asked for: keep the plugin from adding "Always" and motion strings (App Review).
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
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
