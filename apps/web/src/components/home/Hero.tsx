import { LAUNCH_CITIES } from '../../content/cities';
import { TIERS } from '../../content/tiers';
import { formatRupees } from '../../lib/money';
import { fromPrice } from '../../lib/pricing';
import { ImageSlot } from '../ui/ImageSlot';

const surat = LAUNCH_CITIES[0];
const entry = surat ? fromPrice('BASIC', surat.tier) : undefined;
const sample = surat ? fromPrice('PROFESSIONAL', surat.tier) : undefined;

/** Bold type on token surfaces, plus a quote preview that shows GST in the same block. */
export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap hero-grid">
        <div>
          <p className="eyebrow">Live in Surat &amp; Mumbai · Pilot in Vadodara</p>
          <h1 id="hero-title">Book a professional photographer. Get your photos in 48 hours.</h1>
          <p className="lead">
            Verified photographers for food, weddings, portraits, products, events, real estate and
            corporate shoots. One clear price, GST shown up front — no haggling, no surprises.
          </p>
          <div className="actions">
            <a className="btn btn-primary" href="#pricing">
              See prices
            </a>
            <a className="btn btn-secondary" href="/cities/">
              Is my city covered?
            </a>
          </div>
          <ul className="facts">
            {entry ? (
              <li>
                <strong>From {formatRupees(entry.basePaise)} + GST</strong>2-hour minimum
              </li>
            ) : null}
            <li>
              <strong>RAW + JPEG in 48 h</strong>after your shoot ends
            </li>
            <li>
              <strong>KYC &amp; police verified</strong>every photographer
            </li>
          </ul>
        </div>
        {sample && surat ? (
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
        ) : null}
      </div>
    </section>
  );
}
