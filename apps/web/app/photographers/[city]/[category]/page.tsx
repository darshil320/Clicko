import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PriceFactors } from '../../../../src/components/pricing/PriceFactors';
import { TierGrid } from '../../../../src/components/pricing/TierCards';
import {
  CategoryLinks,
  CityNotes,
  OtherCities,
  PageHero,
} from '../../../../src/components/seo/SeoParts';
import { FaqList } from '../../../../src/components/ui/FaqList';
import { JsonLd } from '../../../../src/components/ui/JsonLd';
import { Section } from '../../../../src/components/ui/Section';
import { findCategory } from '../../../../src/content/categories';
import { findCity } from '../../../../src/content/cities';
import { localAngle } from '../../../../src/content/local-angles';
import { TIERS } from '../../../../src/content/tiers';
import { breadcrumbLd, faqPageLd, serviceLd } from '../../../../src/lib/jsonld';
import { pageMetadata } from '../../../../src/lib/metadata';
import { cityCategoryContent } from '../../../../src/lib/page-content';
import { toCardData } from '../../../../src/lib/pricing';
import { cityCategoryParams } from '../../../../src/lib/routes';

interface Props {
  readonly params: Promise<{ city: string; category: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return cityCategoryParams();
}

async function resolve(params: Props['params']) {
  const { city: citySlug, category: categorySlug } = await params;
  const city = findCity(citySlug);
  const category = findCategory(categorySlug);
  const angle = localAngle(citySlug, categorySlug);
  return city && category && angle ? { city, category, angle } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await resolve(params);
  if (!found) return {};
  const content = cityCategoryContent(found.city, found.category);
  return pageMetadata({
    title: content.title,
    description: content.description,
    path: content.path,
  });
}

export default async function CityCategoryPage({ params }: Props) {
  const found = await resolve(params);
  if (!found) notFound();
  const { city, category, angle } = found;
  const content = cityCategoryContent(city, category);
  const recommended = TIERS[category.recommended.tier];

  return (
    <div className="page">
      <JsonLd
        data={[
          serviceLd({
            name: `${category.label} photography in ${city.name}`,
            serviceType: `${category.label} photography`,
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
        <p className="lead">{category.summary}</p>
        <p className="muted">{angle}</p>
      </PageHero>
      <Section
        id="pricing"
        eyebrow={`${category.label} shoots in ${city.name}`}
        title="Prices for 2 hours"
        lead={
          category.upliftReason
            ? `${category.upliftReason} It is already included below.`
            : `${category.label} shoots are priced at our standard rate — no category uplift.`
        }
      >
        <TierGrid
          cards={content.prices.map(toCardData)}
          label={`${category.label} prices in ${city.name}`}
        />
        <div className="split split-gap">
          <PriceFactors />
          <CityNotes city={city} />
        </div>
      </Section>
      <Section
        id="planning"
        raised
        eyebrow="Planning"
        title={`Planning a ${category.label.toLowerCase()} shoot`}
      >
        <div className="split">
          <div>
            <ul className="checklist">
              {category.planning.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
            <h3>Often booked for</h3>
            <ul className="chips">
              {category.bookedFor.map((use) => (
                <li key={use} className="chip">
                  {use}
                </li>
              ))}
            </ul>
          </div>
          <div className={`card tier recommend tone-${recommended.edge}`}>
            <p className="tier-name">
              <span className="tier-dot" aria-hidden="true" />
              Our recommendation
            </p>
            <h3>{recommended.label}</h3>
            <p className="muted">{category.recommended.why}</p>
          </div>
        </div>
      </Section>
      <Section
        id="faq"
        eyebrow="Help"
        title={`${category.label} photography in ${city.name}: FAQs`}
      >
        <FaqList faqs={content.faqs} />
      </Section>
      <Section id="related" raised title={`More shoots in ${city.name}`}>
        <CategoryLinks city={city} exclude={category.slug} />
        <div className="section-foot">
          <OtherCities current={city} category={category} />
        </div>
      </Section>
    </div>
  );
}
