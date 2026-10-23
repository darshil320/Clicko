import { typography } from '@clickco/design-tokens';

export type TextVariant = keyof typeof typography.scale;
type Weight = (typeof typography.scale)[TextVariant]['weight'];
type FontKind = 'display' | 'body';

const WEIGHT_NAME: Readonly<Record<Weight, string>> = {
  '400': 'Regular',
  '500': 'Medium',
  '600': 'SemiBold',
  '700': 'Bold',
};

/** display / h1–h3 set in Inter Tight; everything else in Inter (DESIGN.md §Typography). */
const DISPLAY_VARIANTS: ReadonlySet<TextVariant> = new Set(['display', 'h1', 'h2', 'h3']);

/**
 * React Native picks a font by family name, and Android cannot select a weight from one
 * family name reliably, so each weight is loaded as its own face: "Inter-SemiBold",
 * "InterTight-Bold". The app loads exactly the faces listed in FONT_FACES.
 */
export function fontFace(kind: FontKind, weight: Weight): string {
  const family = kind === 'display' ? typography.family.display : typography.family.body;
  return `${family.replace(/\s+/g, '')}-${WEIGHT_NAME[weight]}`;
}

export function fontFaceFor(variant: TextVariant): string {
  const kind: FontKind = DISPLAY_VARIANTS.has(variant) ? 'display' : 'body';
  return fontFace(kind, typography.scale[variant].weight);
}

/** Every face the primitives can request, de-duplicated. */
export const FONT_FACES: readonly string[] = [
  ...new Set((Object.keys(typography.scale) as TextVariant[]).map(fontFaceFor)),
];
