import { MEDIA_OPTIONS, MOMENTS } from '../../content/moments';
import { REELS } from '../../content/reels';
import { TIERS } from '../../content/tiers';
import { quoteFor } from '../../lib/pricing';
import { ButtonArrow } from '../ui/ButtonArrow';
import { ReelVideo } from '../ui/ReelVideo';
import { Section } from '../ui/Section';

/** The cheaper launch city tier (Surat, Vadodara), so every "from" price is a true floor. */
const FROM_CITY_TIER = 'TIER_1';

/**
 * Real reasons people book (ADR-0023). Each card is a bookable shoot: its "from" price comes from
 * the rate card and "Book this" fills the hero picker with it (`#shoot-<id>`).
 */
export function Moments() {
  return (
    <Section
      id="moments"
      eyebrow="Book it for"
      title={
        <>
          Made for moments <em>like this.</em>
        </>
      }
      lead="Not just weddings. Pick the moment, we send the pro. Photo prices from Surat and Vadodara; video is priced in the app. Reels shown are licensed samples."
    >
      <ul className="moments">
        {MOMENTS.map((moment) => {
          const { category, tier, hours, media } = moment.preset;
          const price = quoteFor(tier, FROM_CITY_TIER, category, hours);
          const reel = REELS[moment.reel];
          const mediaLabel = MEDIA_OPTIONS.find((m) => m.value === media)?.label;
          return (
            <li key={moment.id} className="moment">
              {reel ? <ReelVideo reel={reel} className="moment-reel" /> : null}
              <div className="moment-body">
                <span className="moment-tag">{moment.tag}</span>
                <h3>{moment.title}</h3>
                <p className="muted">{moment.body}</p>
                <p className="moment-meta">
                  {TIERS[tier].label} · {hours} h · {mediaLabel}
                </p>
                <p className="moment-price num">
                  Photos from <strong>{price.base}</strong> + GST
                </p>
                <a className="btn btn-dark btn-sm" href={`#shoot-${moment.id}`}>
                  Book this
                  <ButtonArrow />
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
