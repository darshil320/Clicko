import { CATEGORIES } from '../../content/categories';
import { LAUNCH_CITIES } from '../../content/cities';
import { HERO_PICKER } from '../../content/home';
import { CATEGORY_PHOTOS } from '../../content/photos';
import { BOOKABLE_TIERS, type CategoryCode, MIN_HOURS } from '../../content/rate-card';
import { TIERS } from '../../content/tiers';
import { paths } from '../../lib/routes';
import { Icon } from '../ui/Icon';
import { HeroPicker, type PickerCategory, type PickerCity, type PickerTier } from './HeroPicker';

/** Only what the picker draws crosses to the client: no FAQs, planning notes or city copy. */
const categories: readonly PickerCategory[] = CATEGORIES.map((category) => ({
  code: category.code,
  label: category.label,
  recommended: category.recommended.tier,
  photo: CATEGORY_PHOTOS[category.code],
}));

const cities: readonly PickerCity[] = LAUNCH_CITIES.map((city) => ({
  slug: city.slug,
  name: city.name,
  tier: city.tier,
  pilot: city.status === 'PILOT',
  links: Object.fromEntries(
    CATEGORIES.map((category) => [category.code, paths.cityCategory(city, category)]),
  ) as Record<CategoryCode, string>,
}));

const tiers: readonly PickerTier[] = BOOKABLE_TIERS.map((code) => ({
  code,
  label: TIERS[code].label,
}));

function Proof() {
  return (
    <ul className="facts hero-facts">
      <li>
        <Icon name="check" />
        <span>
          <strong>RAW + JPEG in 48 h</strong> after your shoot ends
        </span>
      </li>
      <li>
        <Icon name="check" />
        <span>
          <strong>KYC &amp; police verified</strong> every photographer
        </span>
      </li>
      <li>
        <Icon name="check" />
        <span>
          <strong>GST shown up front</strong> no haggling, no surprises
        </span>
      </li>
    </ul>
  );
}

/**
 * Product-led hero (ADR-0019, after Urban Company's service picker): the headline, then the
 * shoot picker with the live price, and a sample photo of the chosen category.
 */
export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <HeroPicker
        categories={categories}
        cities={cities}
        tiers={tiers}
        hours={{ min: MIN_HOURS, max: HERO_PICKER.maxHours }}
        defaultTier={HERO_PICKER.defaultTier}
        waitlistHref="#waitlist"
        aside={<Proof />}
      >
        <p className="hero-kicker">Live in Surat &amp; Mumbai · Pilot in Vadodara</p>
        <h1 id="hero-title">
          Book a professional photographer. <em>Photos in 48 hours.</em>
        </h1>
      </HeroPicker>
    </section>
  );
}
