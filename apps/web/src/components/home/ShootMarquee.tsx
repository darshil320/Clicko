import { CATEGORIES } from '../../content/categories';
import { LAUNCH_CITIES } from '../../content/cities';
import { Marquee, type MarqueeItem } from '../ui/Marquee';
import { CATEGORY_MOOD } from '../ui/PhotoFrame';

/** Categories with a launch city after every second one: "Food · Wedding · Surat · Portrait …". */
const ITEMS: readonly MarqueeItem[] = CATEGORIES.flatMap((category, index): MarqueeItem[] => {
  const shoot: MarqueeItem = { label: category.label, mood: CATEGORY_MOOD[category.code] };
  const city = index % 2 === 1 ? LAUNCH_CITIES[(index - 1) / 2] : undefined;
  return city ? [shoot, { label: city.name, icon: 'mapPin', strong: true }] : [shoot];
});

export function ShootMarquee() {
  return (
    <div className="marquee-band">
      <div className="wrap">
        <p className="marquee-label">
          {CATEGORIES.length} kinds of shoot · {LAUNCH_CITIES.length} cities · one way to book
        </p>
        <Marquee label="What we shoot and where" items={ITEMS} />
      </div>
    </div>
  );
}
