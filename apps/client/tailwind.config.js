/**
 * Every colour, space, radius and type step comes from @clickco/design-tokens.
 * This file adds content paths only — never raw values.
 */
const { tailwindPreset } = require('@clickco/design-tokens');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Dark-first and dark-only (DESIGN.md): no `dark:` variants. 'class' lets Expo's
  // userInterfaceStyle set the scheme on web without NativeWind's media-mode error.
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset'), tailwindPreset],
  plugins: [],
};
