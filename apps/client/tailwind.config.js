/**
 * Every colour, space, radius and type step comes from @clickco/design-tokens.
 * This file adds content paths only — never raw values.
 */
const { lightTailwindPreset } = require('@clickco/design-tokens');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // White theme only (DESIGN-LIGHT.md, ADR-0017): no `dark:` variants. 'class' keeps the OS
  // dark-mode setting from flipping anything (and avoids NativeWind's media-mode error on web).
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset'), lightTailwindPreset],
  plugins: [],
};
