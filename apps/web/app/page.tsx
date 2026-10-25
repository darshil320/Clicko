import type { Metadata } from 'next';
import { AppDownload } from '../src/components/home/AppDownload';
import { Categories } from '../src/components/home/Categories';
import { CitiesServed } from '../src/components/home/CitiesServed';
import { Emergency } from '../src/components/home/Emergency';
import { Hero } from '../src/components/home/Hero';
import { HomeFaq } from '../src/components/home/HomeFaq';
import { HowItWorks } from '../src/components/home/HowItWorks';
import { Pricing } from '../src/components/home/Pricing';
import { Trust } from '../src/components/home/Trust';
import { JsonLd } from '../src/components/ui/JsonLd';
import { WaitlistSection } from '../src/components/waitlist/WaitlistSection';
import { LAUNCH_CITIES } from '../src/content/cities';
import { HOME_FAQS } from '../src/content/home';
import { SITE } from '../src/content/site';
import { faqPageLd, organizationLd } from '../src/lib/jsonld';
import { pageMetadata } from '../src/lib/metadata';
import { paths } from '../src/lib/routes';

export const metadata: Metadata = pageMetadata({
  title: `${SITE.name} — Book a professional photographer in Surat, Mumbai & Vadodara`,
  absoluteTitle: true,
  description: SITE.description,
  path: paths.home,
});

export default function Home() {
  return (
    <div className="page">
      <JsonLd data={[organizationLd(LAUNCH_CITIES), faqPageLd(HOME_FAQS)]} />
      <Hero />
      <HowItWorks />
      <Trust />
      <Pricing />
      <Categories />
      <Emergency />
      <CitiesServed />
      <WaitlistSection />
      <HomeFaq />
      <AppDownload />
    </div>
  );
}
