import { describe, expect, it } from 'vitest';
import { LAUNCH_CITIES } from '../content/cities';
import { breadcrumbLd, faqPageLd, organizationLd, serializeJsonLd, serviceLd } from './jsonld';
import { categoryFromPrices } from './pricing';

const surat = LAUNCH_CITIES[0];
if (!surat) throw new Error('Surat missing from launch cities');

describe('organizationLd', () => {
  it('describes Clickco, operated by Clicko, serving the three launch cities', () => {
    const org = organizationLd(LAUNCH_CITIES);
    expect(org).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Clickco',
      legalName: 'Clicko',
      url: 'https://clickco.in/',
    });
    expect(org.areaServed).toHaveLength(3);
  });
});

describe('breadcrumbLd', () => {
  it('numbers items from 1 with absolute URLs', () => {
    const ld = breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Surat', path: '/photographers/surat/' },
    ]);
    expect(ld.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://clickco.in/' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Surat',
        item: 'https://clickco.in/photographers/surat/',
      },
    ]);
  });
});

describe('faqPageLd', () => {
  it('maps each FAQ to a Question with an accepted Answer', () => {
    const ld = faqPageLd([{ question: 'Is GST included?', answer: 'No, it is shown separately.' }]);
    expect(ld).toMatchObject({
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is GST included?',
          acceptedAnswer: { '@type': 'Answer', text: 'No, it is shown separately.' },
        },
      ],
    });
  });
});

describe('serviceLd', () => {
  const ld = serviceLd({
    name: 'Professional photography in Surat',
    serviceType: 'Photography',
    description: 'Photographers in Surat.',
    path: '/photographers/surat/',
    city: surat,
    prices: categoryFromPrices(surat.tier),
  });

  it('is a Service in Surat, Gujarat, provided by the organisation', () => {
    expect(ld).toMatchObject({
      '@type': 'Service',
      url: 'https://clickco.in/photographers/surat/',
      areaServed: { '@type': 'City', name: 'Surat', containedInPlace: { name: 'Gujarat' } },
      provider: { '@type': 'Organization', name: 'Clickco' },
    });
  });

  it('offers each bookable tier for 2 hours in INR, GST exclusive', () => {
    const offers = ld.offers as Array<Record<string, unknown>>;
    expect(offers.map((o) => o.price)).toEqual(['3500.00', '5500.00', '8500.00', '14000.00']);
    for (const offer of offers) {
      expect(offer.priceCurrency).toBe('INR');
      expect(offer.priceSpecification).toMatchObject({
        valueAddedTaxIncluded: false,
        referenceQuantity: { value: 2, unitCode: 'HUR' },
      });
    }
  });
});

describe('serializeJsonLd', () => {
  it('escapes "<" so content can never close the script tag', () => {
    const out = serializeJsonLd({ text: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('<');
    expect(JSON.parse(out)).toEqual({ text: '</script><script>alert(1)</script>' });
  });
});
