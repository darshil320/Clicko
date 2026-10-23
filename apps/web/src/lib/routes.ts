import { CATEGORIES, type Category } from '../content/categories';
import { LAUNCH_CITIES, type LaunchCity } from '../content/cities';
import { SITE } from '../content/site';

/** "Real Estate" → "real-estate". Lowercase ASCII words joined by single hyphens. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Every path ends in "/" because the export uses trailingSlash (next.config.ts). */
export const paths = {
  home: '/',
  cities: '/cities/',
  cityHub: (city: Pick<LaunchCity, 'slug'>) => `/photographers/${city.slug}/`,
  cityCategory: (city: Pick<LaunchCity, 'slug'>, category: Pick<Category, 'slug'>) =>
    `/photographers/${city.slug}/${category.slug}/`,
} as const;

/** "/photographers/surat/" → "https://clickco.in/photographers/surat/". */
export function absoluteUrl(path: string): string {
  if (!path.startsWith('/')) throw new RangeError(`path must start with "/": ${path}`);
  return new URL(path, SITE.url).toString();
}

export function cityParams(): Array<{ city: string }> {
  return LAUNCH_CITIES.map((city) => ({ city: city.slug }));
}

export function cityCategoryParams(): Array<{ city: string; category: string }> {
  return LAUNCH_CITIES.flatMap((city) =>
    CATEGORIES.map((category) => ({ city: city.slug, category: category.slug })),
  );
}
