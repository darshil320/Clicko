import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../content/categories';
import { LAUNCH_CITIES } from '../content/cities';
import {
  absoluteUrl,
  cityCategoryParams,
  cityParams,
  paths,
  SLUG_PATTERN,
  slugify,
} from './routes';

describe('slugify', () => {
  it.each([
    ['Real Estate', 'real-estate'],
    ['Food', 'food'],
    ['  Semi-Pro  ', 'semi-pro'],
    ['Navratri & Diwali', 'navratri-and-diwali'],
    ['Café Mocha', 'cafe-mocha'],
    ['Delhi NCR!', 'delhi-ncr'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('route slugs', () => {
  it('derives every category slug from its label', () => {
    for (const category of CATEGORIES) expect(category.slug).toBe(slugify(category.label));
  });

  it('derives every city slug from its name', () => {
    for (const city of LAUNCH_CITIES) expect(city.slug).toBe(slugify(city.name));
  });

  it('only uses URL-safe slugs', () => {
    const slugs = [...CATEGORIES.map((c) => c.slug), ...LAUNCH_CITIES.map((c) => c.slug)];
    for (const slug of slugs) expect(slug).toMatch(SLUG_PATTERN);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('static params', () => {
  it('builds 3 city hubs', () => {
    expect(cityParams()).toEqual([{ city: 'surat' }, { city: 'mumbai' }, { city: 'vadodara' }]);
  });

  it('builds 3 cities × 7 categories = 21 unique pages', () => {
    const params = cityCategoryParams();
    expect(params).toHaveLength(21);
    expect(new Set(params.map((p) => `${p.city}/${p.category}`)).size).toBe(21);
    expect(params).toContainEqual({ city: 'mumbai', category: 'real-estate' });
  });
});

describe('paths and absolute URLs', () => {
  it('ends every path with a slash to match trailingSlash export', () => {
    const [city] = LAUNCH_CITIES;
    const [category] = CATEGORIES;
    if (!city || !category) throw new Error('content missing');
    expect(paths.cityHub(city)).toBe('/photographers/surat/');
    expect(paths.cityCategory(city, category)).toBe('/photographers/surat/food/');
  });

  it('builds canonical URLs on https://clickco.in', () => {
    expect(absoluteUrl('/')).toBe('https://clickco.in/');
    expect(absoluteUrl('/photographers/mumbai/wedding/')).toBe(
      'https://clickco.in/photographers/mumbai/wedding/',
    );
    expect(() => absoluteUrl('cities/')).toThrow(RangeError);
  });
});
