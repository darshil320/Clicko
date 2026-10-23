import type { Category } from '../content/categories';
import type { LaunchCity } from '../content/cities';
import { TIERS } from '../content/tiers';
import type { Faq } from '../content/types';
import type { Crumb } from './jsonld';
import { formatRupees } from './money';
import { categoryFromPrices, type FromPrice } from './pricing';
import { paths } from './routes';

export interface SeoPageContent {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly h1: string;
  readonly crumbs: readonly Crumb[];
  readonly prices: readonly FromPrice[];
  readonly faqs: readonly Faq[];
}

function priceAt(prices: readonly FromPrice[], tier: FromPrice['tier']): FromPrice {
  const found = prices.find((price) => price.tier === tier);
  if (!found) throw new Error(`no price for ${tier}`);
  return found;
}

const DELIVERY_FAQ: Faq = {
  question: 'How quickly will I get my photos?',
  answer:
    'Within 48 hours of the shoot ending and the balance being paid: every delivered frame as ' +
    'camera RAW plus a full-resolution JPEG. RAW files stay available for 7 days and JPEGs for ' +
    '30 days, so download them promptly.',
};

export function cityHubContent(city: LaunchCity): SeoPageContent {
  const path = paths.cityHub(city);
  const prices = categoryFromPrices(city.tier);
  const basic = priceAt(prices, 'BASIC');
  const professional = priceAt(prices, 'PROFESSIONAL');
  return {
    path,
    title: `Photographers in ${city.name} — from ${formatRupees(basic.basePaise)} + GST`,
    description:
      `Book a verified photographer in ${city.name} for food, weddings, portraits, products, ` +
      `events, real estate or corporate shoots. 2 hours from ${formatRupees(basic.basePaise)} + ` +
      'GST, photos in 48 hours.',
    h1: `Professional photographers in ${city.name}`,
    crumbs: [
      { name: 'Home', path: paths.home },
      { name: 'Cities', path: paths.cities },
      { name: city.name, path },
    ],
    prices,
    faqs: [
      {
        question: `How much does a photographer cost in ${city.name}?`,
        answer:
          `A 2-hour Basic shoot in ${city.name} starts at ${formatRupees(basic.basePaise)} + GST ` +
          `(${formatRupees(basic.totalPaise)} with GST). Professional starts at ` +
          `${formatRupees(professional.basePaise)} + GST. Food, product, real estate, corporate ` +
          'and wedding shoots add a category uplift, and the app shows the full price before you pay.',
      },
      ...city.faqs,
      DELIVERY_FAQ,
    ],
  };
}

export function cityCategoryContent(city: LaunchCity, category: Category): SeoPageContent {
  const path = paths.cityCategory(city, category);
  const prices = categoryFromPrices(city.tier, category.code);
  const basic = priceAt(prices, 'BASIC');
  const recommended = priceAt(prices, category.recommended.tier);
  const coverage = city.faqs[0];
  const roleTitle = category.role.charAt(0).toUpperCase() + category.role.slice(1);
  return {
    path,
    title: `${roleTitle} in ${city.name} — from ${formatRupees(basic.basePaise)} + GST`,
    description:
      `Book a verified ${category.role} in ${city.name}. 2 hours from ` +
      `${formatRupees(basic.basePaise)} + GST, RAW + JPEG in 48 hours. ${category.summary}`,
    h1: `${category.label} photographers in ${city.name}`,
    crumbs: [
      { name: 'Home', path: paths.home },
      { name: 'Cities', path: paths.cities },
      { name: city.name, path: paths.cityHub(city) },
      { name: `${category.label} photography`, path },
    ],
    prices,
    faqs: [
      {
        question: `How much does a ${category.role} cost in ${city.name}?`,
        answer:
          `A 2-hour Basic ${category.label.toLowerCase()} shoot in ${city.name} starts at ` +
          `${formatRupees(basic.basePaise)} + GST (${formatRupees(basic.totalPaise)} with GST). ` +
          `We recommend ${TIERS[category.recommended.tier].label} at ` +
          `${formatRupees(recommended.basePaise)} + GST for 2 hours. Weekends, nights, festival ` +
          'dates and short notice cost more; the app shows the full price before you pay.',
      },
      ...category.faqs,
      ...(coverage ? [coverage] : []),
    ],
  };
}
