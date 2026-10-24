import type { CategoryCode } from '../../content/rate-card';
import { IconChip, type IconName } from './Icon';

/** One glyph per launch category. Typed on CategoryCode, so a new category fails to compile. */
const CATEGORY_GLYPH: Readonly<Record<CategoryCode, IconName>> = {
  FOOD: 'utensils',
  WEDDING: 'heart',
  PORTRAIT: 'user',
  PRODUCT: 'package',
  EVENT: 'calendar',
  REAL_ESTATE: 'home',
  CORPORATE: 'briefcase',
};

export function CategoryIcon({ code }: { readonly code: CategoryCode }) {
  return <IconChip name={CATEGORY_GLYPH[code]} />;
}

export function categoryGlyph(code: CategoryCode): IconName {
  return CATEGORY_GLYPH[code];
}
