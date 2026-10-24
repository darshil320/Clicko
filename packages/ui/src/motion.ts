import { motion } from '@clickco/design-tokens';

/** Pure motion maths (no React Native imports) so it can be unit-tested. DESIGN-LIGHT §Motion. */

export type CubicBezier = readonly [number, number, number, number];

const NUMBER = String.raw`\s*(-?\d*\.?\d+)\s*`;
const BEZIER = new RegExp(`^cubic-bezier\\(${NUMBER},${NUMBER},${NUMBER},${NUMBER}\\)$`);

/** "cubic-bezier(0.22, 1, 0.36, 1)" → [0.22, 1, 0.36, 1]. Throws on anything else. */
export function parseCubicBezier(css: string): CubicBezier {
  const match = BEZIER.exec(css.trim());
  const values = match ? match.slice(1, 5).map(Number) : [];
  if (values.length !== 4 || values.some(Number.isNaN)) {
    throw new Error(`Not a cubic-bezier(): ${css}`);
  }
  const [x1, y1, x2, y2] = values as [number, number, number, number];
  return [x1, y1, x2, y2];
}

/** The one ease-out curve every transition uses. */
export const EASE_OUT: CubicBezier = parseCubicBezier(motion.easeOut);

/** Press feedback (motion.fastMs): a 2% shrink and a light fade — felt, not seen. */
export const PRESS_SCALE = 0.98;
export const PRESS_OPACITY = 0.88;

/** List reveals step 40 ms apart and stop growing after six items, so long lists never lag. */
export const STAGGER_MS = 40;
export const MAX_STAGGER_STEPS = 6;

/** Delay before item `index` of a list starts its reveal. */
export function revealDelay(index: number): number {
  const step = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return Math.min(step, MAX_STAGGER_STEPS) * STAGGER_MS;
}
