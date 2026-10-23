import { LEAD_TIME_BANDS } from '../../content/rate-card';
import { multiplierLabel } from '../../lib/pricing';
import { Section } from '../ui/Section';

const BEST_EFFORT = new Set(['HOURS_3_8', 'HOURS_UNDER_3']);

/** Honest emergency explainer: best effort under 8 hours, automatic refund if unfilled (v0.2 §8, T&C §3.7). */
export function Emergency() {
  return (
    <Section
      id="emergency"
      raised
      eyebrow="Same-day and emergency"
      title="Need a photographer today?"
      lead="We will try — but we will not over-promise. Short-notice shoots cost more, and with less than 8 hours’ notice we cannot guarantee a photographer."
    >
      <ol className="grid grid-5">
        {LEAD_TIME_BANDS.map((band) => {
          const urgent = BEST_EFFORT.has(band.code);
          return (
            <li key={band.code} className={`card band edge ${urgent ? 'edge-emergency' : ''}`}>
              {urgent ? <span className="badge badge-emergency">Best effort</span> : null}
              <h3>{band.leadTime}</h3>
              <dl>
                <div>
                  <dt>Price</dt>
                  <dd className="num">
                    {band.multiplierBps === 10_000
                      ? 'Standard price'
                      : `${multiplierLabel(band.multiplierBps)} the standard price`}
                  </dd>
                </div>
                <div>
                  <dt>Our promise</dt>
                  <dd>{band.promise}</dd>
                </div>
                <div>
                  <dt>Payment</dt>
                  <dd>{band.payment}</dd>
                </div>
                <div>
                  <dt>If no one accepts</dt>
                  <dd>{band.ifUnfilled}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
      <div className="notice notice-emergency gap-top">
        <p className="notice-title">How an under-3-hour booking works</p>
        <p>
          Your card or UPI payment is only authorised, not charged. We alert every photographer in
          the city who takes emergency jobs, all at once. The charge goes through only when one
          accepts. If nobody has accepted 90 minutes before your start time, we cancel and release
          the full amount automatically — and tell you, so you are never left waiting for someone
          who is not coming.
        </p>
      </div>
    </Section>
  );
}
