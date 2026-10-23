import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HowItWorks } from '../../../src/components/home/HowItWorks';
import { PriceFactors } from '../../../src/components/pricing/PriceFactors';
import { TierGrid } from '../../../src/components/pricing/TierCards';
import {
  CategoryLinks,
  CityNotes,
  OtherCities,
  PageHero,
} from '../../../src/components/seo/SeoParts';
import { FaqList } from '../../../src/components/ui/FaqList';
import { JsonLd } from '../../../src/components/ui/JsonLd';
import { Section } from '../../../src/components/ui/Section';
import { findCity } from '../../../src/content/cities';
import { breadcrumbLd, faqPageLd, serviceLd } from '../../../src/lib/jsonld';
import { pageMetadata } from '../../../src/lib/metadata';
import { cityHubContent } from '../../../src/lib/page-content';
import { toCardData } from '../../../src/lib/pricing';
import { cityParams } from '../../../src/lib/routes';

interface Props {
  readonly params: Promise<{ city: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return cityParams();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const city = findCity((await params).city);
  if (!city) return {};
  const content = cityHubContent(city);
  return pageMetadata({
    title: content.title,
    description: content.description,
    path: content.path,
  });
}

export default async function CityHub({ params }: Props) {
  const city = findCity((await params).city);
  if (!city) notFound();
  const content = cityHubContent(city);

  return (
    <div className="page">
      <JsonLd
        data={[
          serviceLd({
            name: `Professional photography in ${city.name}`,
            serviceType: 'Photography',
            description: content.description,
            path: content.path,
            city,
            prices: content.prices,
          }),
          breadcrumbLd(content.crumbs),
          faqPageLd(content.faqs),
        ]}
      />
      <PageHero crumbs={content.crumbs} city={city} title={content.h1}>
        <p className="lead">{city.intro}</p>
      </PageHero>
      <Section
        id="pricing"
        eyebrow={`Prices in ${city.name}`}
        title="Choose your tier"
        lead="Prices for a 2-hour portrait or event shoot, exclusive of 18% GST, with the GST-inclusive total beside each one."
      >
        <TierGrid cards={content.prices.map(toCardData)} label={`Prices in ${city.name}`} />
        <div className="split split-gap">
          <PriceFactors />
          <CityNotes city={city} />
        </div>
      </Section>
      <Section
        id="categories"
        raised
        eyebrow="What we shoot"
        title={`Shoots in ${city.name}`}
        lead="Each category has its own photographers, planning notes and price."
      >
        <CategoryLinks city={city} />
      </Section>
      <HowItWorks />
      <Section id="faq" raised eyebrow="Help" title={`Booking a photographer in ${city.name}`}>
        <FaqList faqs={content.faqs} />
      </Section>
      <Section id="other-cities" title="Other cities">
        <OtherCities current={city} />
        <p className="section-foot">
          Somewhere else? <a href="/cities/#waitlist">Join the waitlist</a>.
        </p>
      </Section>
    </div>
  );
}
