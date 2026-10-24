import { LAUNCH_CITIES } from '../../content/cities';
import { HERO_ACTIVITY } from '../../content/home';
import { TIERS } from '../../content/tiers';
import { formatRupees } from '../../lib/money';
import { fromPrice } from '../../lib/pricing';
import { paths } from '../../lib/routes';
import { ButtonArrow } from '../ui/ButtonArrow';
import { Icon, IconChip } from '../ui/Icon';
import { PhotoFrame } from '../ui/PhotoFrame';

const [surat, mumbai, vadodara] = LAUNCH_CITIES;
const entry = surat ? fromPrice('BASIC', surat.tier) : undefined;
const sample = surat ? fromPrice('PROFESSIONAL', surat.tier) : undefined;

function QuoteCard() {
  if (!sample || !surat) return null;
  return (
    <div className="collage-quote">
      <div className="quote">
        <h2>
          {TIERS.PROFESSIONAL.label} · Portrait · {sample.hours} hours
          <span>{surat.name}</span>
        </h2>
        <dl>
          <div className="quote-row">
            <dt>Photography</dt>
            <dd>{formatRupees(sample.basePaise)}</dd>
          </div>
          <div className="quote-row">
            <dt>GST 18%</dt>
            <dd>{formatRupees(sample.gstPaise)}</dd>
          </div>
          <div className="quote-row quote-sum">
            <dt>You pay</dt>
            <dd>{formatRupees(sample.totalPaise)}</dd>
          </div>
        </dl>
        <p className="quote-meta">
          Weekday daytime, booked 2+ days ahead. 50% to book, the rest after the shoot.
        </p>
      </div>
    </div>
  );
}

/**
 * The photo collage beside the headline: three frames (placeholders until real shoots exist),
 * the app's two status cards (a mock, hidden from assistive tech) and the real sample quote.
 */
function Collage() {
  const frames = TIERS.PROFESSIONAL.framesPerHour * (sample?.hours ?? 0);
  return (
    <div className="hero-stage">
      <PhotoFrame
        mood="golden"
        caption={`Wedding · ${surat?.name ?? ''}`}
        meta="85mm · f/1.8"
        corners
        className="collage-main"
      />
      <PhotoFrame
        mood="plate"
        caption={`Food · ${mumbai?.name ?? ''}`}
        className="collage-side collage-top"
      />
      <PhotoFrame
        mood="coast"
        caption={`Real estate · ${vadodara?.name ?? ''}`}
        className="collage-side collage-bottom"
      />
      <div className="float float-start" aria-hidden="true">
        <IconChip name="userCheck" />
        <span>
          <strong>{HERO_ACTIVITY.assigned}</strong>
          {HERO_ACTIVITY.photographer} · {TIERS.PROFESSIONAL.label}
        </span>
      </div>
      <div className="float float-end" aria-hidden="true">
        <IconChip name="camera" />
        <span>
          <strong>{HERO_ACTIVITY.delivered}</strong>
          {frames} frames · RAW + JPEG
        </span>
      </div>
      <QuoteCard />
    </div>
  );
}

/** Editorial hero (ADR-0018): serif headline with an inline photo, facts, and the collage. */
export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="pill">
            <span className="live-dot" aria-hidden="true" />
            Live in Surat &amp; Mumbai · Pilot in Vadodara
          </p>
          <h1 id="hero-title">
            Book a professional <PhotoFrame mood="golden" shape="pill" /> photographer.{' '}
            <em>Get your photos in 48 hours.</em>
          </h1>
          <p className="lead">
            Verified photographers for food, weddings, portraits, products, events, real estate and
            corporate shoots. One clear price, GST shown up front — no haggling, no surprises.
          </p>
          <div className="actions">
            <a className="btn btn-primary" href="#pricing">
              See prices
              <ButtonArrow />
            </a>
            <a className="btn btn-secondary" href={paths.cities}>
              Is my city covered?
            </a>
          </div>
          <ul className="facts">
            {entry ? (
              <li>
                <Icon name="check" />
                <span>
                  <strong>From {formatRupees(entry.basePaise)} + GST</strong> · 2-hour minimum
                </span>
              </li>
            ) : null}
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
          </ul>
        </div>
        <Collage />
      </div>
    </section>
  );
}
