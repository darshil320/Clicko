import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../content/categories';
import { LAUNCH_CITIES } from '../content/cities';
import { cityCategoryContent, cityHubContent } from './page-content';

const pages = LAUNCH_CITIES.flatMap((city) =>
  CATEGORIES.map((category) => cityCategoryContent(city, category)),
);
const hubs = LAUNCH_CITIES.map(cityHubContent);

describe('programmatic SEO page content', () => {
  it('gives all 24 pages a unique title, description, h1 and path', () => {
    const all = [...hubs, ...pages];
    expect(all).toHaveLength(24);
    for (const key of ['title', 'description', 'h1', 'path'] as const) {
      expect(new Set(all.map((page) => page[key])).size).toBe(all.length);
    }
  });

  it('keeps titles and descriptions to search-friendly lengths', () => {
    for (const page of [...hubs, ...pages]) {
      expect(page.title.length).toBeLessThanOrEqual(70);
      expect(page.description.length).toBeGreaterThan(70);
      expect(page.description.length).toBeLessThanOrEqual(220);
    }
  });

  it('prices the Surat food page with the food uplift', () => {
    const surat = LAUNCH_CITIES[0];
    const food = CATEGORIES[0];
    if (!surat || !food) throw new Error('content missing');
    const page = cityCategoryContent(surat, food);
    expect(page.title).toBe('Food photographer in Surat — from ₹4,025 + GST');
    expect(page.faqs[0]?.answer).toContain('₹4,025 + GST (₹4,749.50 with GST)');
  });

  it('builds breadcrumbs Home › Cities › City › Category', () => {
    const page = pages.find((p) => p.path === '/photographers/mumbai/real-estate/');
    expect(page?.crumbs.map((c) => c.name)).toEqual([
      'Home',
      'Cities',
      'Mumbai',
      'Real Estate photography',
    ]);
  });

  it('gives every page at least three FAQs with unique questions', () => {
    for (const page of [...hubs, ...pages]) {
      expect(page.faqs.length).toBeGreaterThanOrEqual(3);
      expect(new Set(page.faqs.map((f) => f.question)).size).toBe(page.faqs.length);
    }
  });
});
