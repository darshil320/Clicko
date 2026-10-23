import type { MetadataRoute } from 'next';
import { sitemapEntries } from '../src/lib/sitemap-entries';

// Static export: rendered once to out/sitemap.xml.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries().map((entry) => ({ ...entry }));
}
