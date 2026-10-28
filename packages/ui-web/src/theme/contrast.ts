/** WCAG 2.x colour maths for the theme tests: relative luminance, contrast and alpha blending. */

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Expected #RRGGBB, got ${hex}`);
  return [
    Number.parseInt(m[1] ?? '', 16),
    Number.parseInt(m[2] ?? '', 16),
    Number.parseInt(m[3] ?? '', 16),
  ];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two opaque colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` at `percent`% opacity over an opaque `base` (what `bg-x/10` paints on a card). */
export function blend(top: string, percent: number, base: string): string {
  const t = parseHex(top);
  const b = parseHex(base);
  const a = percent / 100;
  return toHex([0, 1, 2].map((i) => (t[i] ?? 0) * a + (b[i] ?? 0) * (1 - a)) as unknown as Rgb);
}

export const WCAG_AA_TEXT = 4.5;
