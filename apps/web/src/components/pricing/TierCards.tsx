import { SIGNATURE_MIN_HOURS } from '../../content/rate-card';
import { CONTACT } from '../../content/site';
import { TIERS } from '../../content/tiers';
import type { PriceCardData } from '../../lib/pricing';

/** Plain presentational markup: rendered on the server, and inside the city switcher. */
export function TierCard({ card }: { readonly card: PriceCardData }) {
  const tier = TIERS[card.tier];
  return (
    <li className={`card edge edge-${tier.edge}`}>
      <p className="tier-name">{tier.label}</p>
      <p className="price-line">
        {card.base} <small>+ GST</small>
      </p>
      <p className="price-note">
        {card.total} incl. 18% GST for {card.hours} hours
        <br />
        Each extra hour {card.extraHour} + GST
      </p>
      <p className="muted">{tier.tagline}</p>
      <ul className="checklist">
        {tier.highlights.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </li>
  );
}

export function SignatureCard() {
  const tier = TIERS.SIGNATURE;
  return (
    <li className={`card edge edge-${tier.edge}`}>
      <p className="tier-name">{tier.label}</p>
      <p className="price-line">On request</p>
      <p className="price-note">
        Quoted by our team, minimum {SIGNATURE_MIN_HOURS} hours
        <br />
        50% advance once you accept the quote
      </p>
      <p className="muted">{tier.tagline}</p>
      <ul className="checklist">
        {tier.highlights.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="push">
        <a href={CONTACT.signatureEnquiry}>Enquire about Signature</a>
      </p>
    </li>
  );
}

export function TierGrid({
  cards,
  label,
}: {
  readonly cards: readonly PriceCardData[];
  readonly label: string;
}) {
  return (
    <ul className="grid grid-5" aria-label={label}>
      {cards.map((card) => (
        <TierCard key={card.tier} card={card} />
      ))}
      <SignatureCard />
    </ul>
  );
}
