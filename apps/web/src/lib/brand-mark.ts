import { color, radius } from '@clickco/design-tokens';

/**
 * The Clickco mark — an amber lens ring on the base surface — as an SVG string built from
 * design tokens at export time, so no colour value is written into the app.
 */
export function brandMarkSvg(size = 64): string {
  const ring = { r: 17, width: 7 };
  const circumference = Math.PI * 2 * ring.r;
  const gap = circumference / 4;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">`,
    `<rect width="64" height="64" rx="${radius.md + 2}" fill="${color.surface.base}"/>`,
    `<circle cx="32" cy="32" r="${ring.r}" fill="none" stroke="${color.accent.default}" `,
    `stroke-width="${ring.width}" stroke-linecap="round" `,
    `stroke-dasharray="${(circumference - gap).toFixed(2)} ${gap.toFixed(2)}" `,
    'transform="rotate(45 32 32)"/>',
    `<circle cx="32" cy="32" r="5" fill="${color.accent.default}"/>`,
    '</svg>',
  ].join('');
}
