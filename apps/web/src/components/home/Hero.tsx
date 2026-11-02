import { CATEGORIES } from '../../content/categories';
import { LAUNCH_CITIES } from '../../content/cities';
import { HERO_PICKER } from '../../content/home';
import { MOMENTS } from '../../content/moments';
import { CATEGORY_PHOTOS } from '../../content/photos';
import { BOOKABLE_TIERS, type CategoryCode, MIN_HOURS } from '../../content/rate-card';
import { CATEGORY_REEL, REELS } from '../../content/reels';
import { TIERS } from '../../content/tiers';
import { paths } from '../../lib/routes';
import { HeroPicker } from './HeroPicker';
import type { PickerCategory, PickerCity, PickerTier, Shoot, ShootPreset } from './picker/types';

const HERO_REEL = 'hero';

/** Only what the picker draws crosses to the client: no FAQs, planning notes or city copy. */
const categories: readonly PickerCategory[] = CATEGORIES.map((category) => ({
  code: category.code,
  label: category.label,
  recommended: category.recommended.tier,
  photo: CATEGORY_PHOTOS[category.code],
  reel: CATEGORY_REEL[category.code],
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

const presets: Readonly<Record<string, ShootPreset>> = Object.fromEntries(
  MOMENTS.map((moment) => [moment.id, { ...moment.preset, reel: moment.reel }]),
);

const reels = Object.fromEntries(
  [HERO_REEL, ...MOMENTS.map((moment) => moment.reel), ...Object.values(CATEGORY_REEL)].flatMap(
    (name) => {
      const reel = REELS[name];
      return reel ? [[name, reel] as const] : [];
    },
  ),
);

/**
 * Product-led hero (ADR-0019, ADR-0023): the headline, then the shoot picker (photos, video or
 * both) with the live photo price, beside a sample reel or photo of the chosen shoot.
 */
export function Hero() {
  const first = categories[0];
  const city = cities[0];
  if (!first || !city) return null;
  const initial: Shoot = {
    media: 'BOTH',
    category: first.code,
    city: city.slug,
    tier: HERO_PICKER.defaultTier,
    hours: MIN_HOURS,
    reel: HERO_REEL,
  };
  return (
    <section className="hero" aria-labelledby="hero-title">
      <HeroPicker
        categories={categories}
        cities={cities}
        tiers={tiers}
        hours={{ min: MIN_HOURS, max: HERO_PICKER.maxHours }}
        initial={initial}
        presets={presets}
        reels={reels}
        waitlistHref="#waitlist"
      >
        <h1 id="hero-title">
          Pro photos and video. <span className="accent-phrase">No DMs, no haggling.</span>
        </h1>
      </HeroPicker>
    </section>
  );
}
