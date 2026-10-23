import { describe, expect, it } from 'vitest';
import { sitemapEntries } from './sitemap-entries';

describe('sitemap entries', () => {
  const entries = sitemapEntries();
  const urls = entries.map((e) => e.url);

  it('lists home + /cities + 3 hubs + 21 city × category + 4 legal = 30 URLs', () => {
    expect(entries).toHaveLength(1 + 1 + 3 + 21 + 4);
  });

  it('has no duplicates', () => {
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('uses absolute https://clickco.in URLs with trailing slashes', () => {
    for (const url of urls) {
      expect(url.startsWith('https://clickco.in/')).toBe(true);
      expect(url.endsWith('/')).toBe(true);
    }
  });

  it('includes the legal pages required before payment', () => {
    for (const path of ['terms', 'refund-policy', 'privacy', 'grievance']) {
      expect(urls).toContain(`https://clickco.in/${path}/`);
    }
  });

  it('gives the home page top priority and a valid ISO lastmod everywhere', () => {
    expect(entries[0]).toMatchObject({ url: 'https://clickco.in/', priority: 1 });
    for (const entry of entries) expect(entry.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
