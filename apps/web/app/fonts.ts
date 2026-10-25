import { Instrument_Serif, Plus_Jakarta_Sans } from 'next/font/google';

/**
 * Daylight families (ADR-0020), self-hosted at build time: visitors never call Google. Each one
 * is exposed as the CSS variable that src/styles/tokens.ts `fontVar` reads.
 */
const sans = Plus_Jakarta_Sans({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

/** Only the one accent phrase per headline uses the serif, always italic. */
const accent = Instrument_Serif({
  weight: '400',
  style: 'italic',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-accent',
});

export const fontClassName = [sans.variable, accent.variable].join(' ');
