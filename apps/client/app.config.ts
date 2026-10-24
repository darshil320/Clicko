import { colorLight } from '@clickco/design-tokens';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Public configuration only. Anything EXPO_PUBLIC_* is inlined into the bundle, so it must
 * never hold a secret. EXPO_PUBLIC_API_URL defaults to the local API (see src/shared/config.ts).
 * Android emulator: EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 · a device: your machine's LAN IP.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Clickco',
  slug: 'clickco-client',
  scheme: 'clickco',
  version: '0.1.0',
  orientation: 'portrait',
  // White theme (ADR-0017): light system chrome, dark status-bar content, white root view.
  userInterfaceStyle: 'light',
  backgroundColor: colorLight.surface.base,
  ios: {
    bundleIdentifier: 'in.clickco.client',
    supportsTablet: false,
  },
  android: {
    package: 'in.clickco.client',
    // The MMKV store holds the session; keep it out of Android Auto Backup.
    allowBackup: false,
  },
  web: {
    bundler: 'metro',
    // Single-page output: the app is session-gated, and MMKV's web backend needs a browser.
    output: 'single',
    backgroundColor: colorLight.surface.base,
  },
  plugins: ['expo-router'],
  experiments: {
    typedRoutes: true,
    tsconfigPaths: true,
  },
});
