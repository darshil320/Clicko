import { LAUNCH_CITIES } from '../../content/cities';
import { HERO_ACTIVITY } from '../../content/home';
import { TIERS } from '../../content/tiers';
import { formatRupees } from '../../lib/money';
import { fromPrice } from '../../lib/pricing';
import { paths } from '../../lib/routes';
import { Icon, IconChip } from '../ui/Icon';
import { ImageSlot } from '../ui/ImageSlot';

const surat = LAUNCH_CITIES[0];
const entry = surat ? fromPrice('BASIC', surat.tier) : undefined;
const sample = surat ? fromPrice('PROFESSIONAL', surat.tier) : undefined;

function QuotePreview() {
  if (!sample || !surat) return null;
  const frames = TIERS.PROFESSIONAL.framesPerHour * sample.hours;
  return (
    <div className="hero-stage">
      <ImageSlot label={`${surat.name} · sample quote`}>
        <div className="quote">
          <h2>
            {TIERS.PROFESSIONAL.label} · Portrait · {sample.hours} hours
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
      </ImageSlot>
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
    </div>
  );
}

/** Airy centred hero on a fading dot grid, then the sample quote with GST in the same block. */
export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap">
        <div className="hero-copy">
          <p className="pill">
            <span className="live-dot" aria-hidden="true" />
            Live in Surat &amp; Mumbai · Pilot in Vadodara
          </p>
          <h1 id="hero-title">
            Book a professional photographer.{' '}
            <span className="soft">Get your photos in 48 hours.</span>
          </h1>
          <p className="lead">
            Verified photographers for food, weddings, portraits, products, events, real estate and
            corporate shoots. One clear price, GST shown up front — no haggling, no surprises.
          </p>
          <div className="actions">
            <a className="btn btn-primary" href="#pricing">
              See prices
            </a>
            <a className="btn btn-secondary" href={paths.cities}>
              Is my city covered?
              <Icon name="arrowRight" />
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
        <QuotePreview />
      </div>
    </section>
  );
}
