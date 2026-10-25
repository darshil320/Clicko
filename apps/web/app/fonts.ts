import { Onest } from 'next/font/google';

/**
 * Daylight family (ADR-0022), self-hosted at build time: visitors never call Google. Exposed as
 * the CSS variable that src/styles/tokens.ts `fontVar` reads.
 */
const sans = Onest({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const fontClassName = sans.variable;
