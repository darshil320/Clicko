import { typography } from '@clickco/design-tokens';

/**
 * The height of a multiline field's text area: `numberOfLines` body lines, so a message box shows
 * a few lines and scrolls beyond them. Null keeps the 52pt single-line field: not multiline, no
 * line count, or a single line (the existing multiline fields in Pro stay as they are).
 */
export function multilineTextHeight(
  multiline: boolean,
  numberOfLines: number | undefined,
): number | null {
  if (!multiline || numberOfLines === undefined || numberOfLines < 2) return null;
  return typography.scale.body.lineHeight * Math.floor(numberOfLines);
}
