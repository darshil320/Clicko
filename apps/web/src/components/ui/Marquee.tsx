import { Icon, type IconName } from './Icon';
import { PhotoFrame, type PhotoMood } from './PhotoFrame';

export interface MarqueeItem {
  readonly label: string;
  readonly icon?: IconName;
  /** A tiny inline photo instead of an icon (DESIGN-DAYLIGHT §Imagery). */
  readonly mood?: PhotoMood;
  /** Emphasised items (e.g. cities) read in primary text. */
  readonly strong?: boolean;
}

function MarqueeList({
  items,
  hidden = false,
}: {
  readonly items: readonly MarqueeItem[];
  readonly hidden?: boolean;
}) {
  return (
    <ul className="marquee-list" aria-hidden={hidden ? true : undefined}>
      {items.map((item) => (
        <li key={item.label} className={item.strong ? 'marquee-item marquee-city' : 'marquee-item'}>
          {item.mood ? <PhotoFrame mood={item.mood} shape="pill" /> : null}
          {item.icon && !item.mood ? <Icon name={item.icon} /> : null}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * A slow, endless row of words (Magic UI marquee, rebuilt in token CSS). The second copy is
 * hidden from assistive tech and only shown while motion is allowed; with reduced motion the
 * list simply wraps, still and centred. Items are text, never links: moving targets are hard
 * to hit.
 */
export function Marquee({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly MarqueeItem[];
}) {
  return (
    <section className="marquee" aria-label={label}>
      <div className="marquee-track">
        <MarqueeList items={items} />
        <MarqueeList items={items} hidden />
      </div>
    </section>
  );
}
