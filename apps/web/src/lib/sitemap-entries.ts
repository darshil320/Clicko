import { CATEGORIES } from '../content/categories';
import { LAUNCH_CITIES } from '../content/cities';
import { LEGAL_PATHS, SITE } from '../content/site';
import { absoluteUrl, paths } from './routes';

export interface SitemapEntry {
  readonly url: string;
  readonly lastModified: string;
  readonly changeFrequency: 'weekly' | 'monthly' | 'yearly';
  readonly priority: number;
}

const entry = (
  path: string,
  changeFrequency: SitemapEntry['changeFrequency'],
  priority: number,
): SitemapEntry => ({
  url: absoluteUrl(path),
  lastModified: SITE.contentUpdated,
  changeFrequency,
  priority,
});

/** Home, /cities, 3 city hubs, 21 city × category pages and the 4 legal pages. */
export function sitemapEntries(): readonly SitemapEntry[] {
  return [
    entry(paths.home, 'weekly', 1),
    entry(paths.cities, 'monthly', 0.8),
    ...LAUNCH_CITIES.map((city) => entry(paths.cityHub(city), 'monthly', 0.8)),
    ...LAUNCH_CITIES.flatMap((city) =>
      CATEGORIES.map((category) => entry(paths.cityCategory(city, category), 'monthly', 0.7)),
    ),
    ...LEGAL_PATHS.map((path) => entry(path, 'yearly', 0.3)),
  ];
}
