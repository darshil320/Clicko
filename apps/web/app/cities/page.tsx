import type { Metadata } from 'next';
import { CityCards } from '../../src/components/home/CitiesServed';
import { Breadcrumbs } from '../../src/components/ui/Breadcrumbs';
import { Icon } from '../../src/components/ui/Icon';
import { JsonLd } from '../../src/components/ui/JsonLd';
import { Section } from '../../src/components/ui/Section';
import { WaitlistSection } from '../../src/components/waitlist/WaitlistSection';
import { WAITLIST_EXAMPLES } from '../../src/content/cities';
import { breadcrumbLd, type Crumb } from '../../src/lib/jsonld';
import { pageMetadata } from '../../src/lib/metadata';
import { paths } from '../../src/lib/routes';

const CRUMBS: readonly Crumb[] = [
  { name: 'Home', path: paths.home },
  { name: 'Cities', path: paths.cities },
];

export const metadata: Metadata = pageMetadata({
  title: 'Cities we serve — Surat, Mumbai, Vadodara and the waitlist',
  description:
    'Clickco photographers are live in Surat and Mumbai and in pilot in Vadodara. Anywhere else ' +
    'in India, join the waitlist with your pincode — demand decides where we launch next.',
  path: paths.cities,
});

export default function CitiesPage() {
  return (
    <div className="page">
      <JsonLd data={breadcrumbLd(CRUMBS)} />
      <header className="page-hero">
        <div className="wrap">
          <Breadcrumbs crumbs={CRUMBS} />
          <h1>Where Clickco shoots</h1>
          <p className="lead">
            The Clickco brand and app are pan-India. Photographers are bookable in three cities
            today; every other pincode can join the waitlist.
          </p>
        </div>
      </header>
      <Section
        id="launch-cities"
        title="Bookable now"
        lead="Live cities have our full photographer network. Vadodara is in pilot: same prices, fewer photographers, so book a little earlier."
      >
        <CityCards />
      </Section>
      <Section
        id="coming-next"
        raised
        title="Coming next — you decide where"
        lead={`We open cities in order of waitlist demand. ${WAITLIST_EXAMPLES.slice(0, 4).join(', ')} and every other pincode in India can join.`}
      >
        <ul className="chips" aria-label="Examples of waitlist cities">
          {WAITLIST_EXAMPLES.map((name) => (
            <li key={name} className="chip">
              <Icon name="mapPin" />
              {name}
            </li>
          ))}
        </ul>
      </Section>
      <WaitlistSection />
    </div>
  );
}
