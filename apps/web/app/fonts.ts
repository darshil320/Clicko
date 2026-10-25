import { Figtree, Outfit } from 'next/font/google';

/**
 * Daylight families (ADR-0021), self-hosted at build time: visitors never call Google. Each one
 * is exposed as the CSS variable that src/styles/tokens.ts `fontVar` reads.
 */
const display = Outfit({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});

const body = Figtree({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const fontClassName = [display.variable, body.variable].join(' ');
