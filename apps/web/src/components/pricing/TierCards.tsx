import { SIGNATURE_MIN_HOURS } from '../../content/rate-card';
import { CONTACT } from '../../content/site';
import { TIERS, type TierCopy } from '../../content/tiers';
import type { PriceCardData } from '../../lib/pricing';
import { Icon } from '../ui/Icon';

function TierName({ tier }: { readonly tier: TierCopy }) {
  return (
    <p className="tier-name">
      <span className="tier-dot" aria-hidden="true" />
      {tier.label}
    </p>
  );
}

/** Plain presentational markup: rendered on the server, and inside the city switcher. */
export function TierCard({ card }: { readonly card: PriceCardData }) {
  const tier = TIERS[card.tier];
  return (
    <li className={`card tier tone-${tier.edge}`}>
      <TierName tier={tier} />
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

/** Quote-only tier, laid out full width under the four bookable tiers. */
export function SignatureCard() {
  const tier = TIERS.SIGNATURE;
  return (
    <li className={`card tier tier-signature tone-${tier.edge}`}>
      <TierName tier={tier} />
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
        <a className="text-link" href={CONTACT.signatureEnquiry}>
          Enquire about Signature
          <Icon name="arrowRight" />
        </a>
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
    <ul className="grid grid-4 tiers" aria-label={label}>
      {cards.map((card) => (
        <TierCard key={card.tier} card={card} />
      ))}
      <SignatureCard />
    </ul>
  );
}
