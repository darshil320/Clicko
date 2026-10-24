import { Geist_Mono, Instrument_Serif, Inter_Tight } from 'next/font/google';

/**
 * Daylight families (ADR-0018), self-hosted at build time: visitors never call Google. Each one
 * is exposed as the CSS variable that src/styles/tokens.ts `fontVar` reads.
 */
const display = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});

const body = Inter_Tight({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

const mono = Geist_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const fontClassName = [display.variable, body.variable, mono.variable].join(' ');
