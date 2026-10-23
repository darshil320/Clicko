import type { LaunchCity } from '../content/cities';
import { SITE } from '../content/site';
import { TIERS } from '../content/tiers';
import type { Faq } from '../content/types';
import { decimalRupees } from './money';
import type { FromPrice } from './pricing';
import { absoluteUrl } from './routes';

type JsonLd = Readonly<Record<string, unknown>>;

const CONTEXT = 'https://schema.org';

function organizationRef(): JsonLd {
  return { '@type': 'Organization', '@id': `${absoluteUrl('/')}#organization`, name: SITE.name };
}

export function organizationLd(cities: readonly LaunchCity[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    '@id': `${absoluteUrl('/')}#organization`,
    name: SITE.name,
    legalName: SITE.legalName,
    url: absoluteUrl('/'),
    logo: absoluteUrl('/touch-icon.png'),
    description: SITE.description,
    areaServed: cities.map(cityPlace),
  };
}

function cityPlace(city: LaunchCity): JsonLd {
  return {
    '@type': 'City',
    name: city.name,
    containedInPlace: { '@type': 'State', name: city.state },
  };
}

export interface Crumb {
  readonly name: string;
  readonly path: string;
}

export function breadcrumbLd(crumbs: readonly Crumb[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

export function faqPageLd(faqs: readonly Faq[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

export interface ServiceLdInput {
  readonly name: string;
  readonly serviceType: string;
  readonly description: string;
  readonly path: string;
  readonly city: LaunchCity;
  readonly prices: readonly FromPrice[];
}

/** One Offer per bookable tier, priced for the 2-hour minimum, GST exclusive. */
export function serviceLd(input: ServiceLdInput): JsonLd {
  const url = absoluteUrl(input.path);
  return {
    '@context': CONTEXT,
    '@type': 'Service',
    name: input.name,
    serviceType: input.serviceType,
    description: input.description,
    url,
    provider: organizationRef(),
    areaServed: cityPlace(input.city),
    offers: input.prices.map((price) => {
      const amount = decimalRupees(price.basePaise);
      return {
        '@type': 'Offer',
        name: `${TIERS[price.tier].label} — ${price.hours} hours`,
        url,
        price: amount,
        priceCurrency: 'INR',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: amount,
          priceCurrency: 'INR',
          valueAddedTaxIncluded: false,
          referenceQuantity: { '@type': 'QuantitativeValue', value: price.hours, unitCode: 'HUR' },
        },
      };
    }),
  };
}

/** JSON for a <script type="application/ld+json">; "<" is escaped so content cannot end the tag. */
export function serializeJsonLd(data: JsonLd | readonly JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
