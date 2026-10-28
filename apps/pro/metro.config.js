/**
 * Metro for a pnpm workspace with the default isolated node_modules layout.
 *
 * - getDefaultConfig() detects the workspace (SDK 52+): it watches the repo root so
 *   packages/ui (shipped as TS source) and the built packages/* dist folders hot-reload,
 *   and resolves through the symlinked node_modules (isolated installs are supported
 *   from SDK 54).
 * - withNativeWind() compiles global.css with the @clickco/design-tokens Tailwind preset.
 *   inlineRem 16 keeps rem identical on native and web.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
