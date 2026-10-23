import type { MetadataRoute } from 'next';
import { absoluteUrl } from '../src/lib/routes';

// Static export: rendered once to out/robots.txt.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  };
}
