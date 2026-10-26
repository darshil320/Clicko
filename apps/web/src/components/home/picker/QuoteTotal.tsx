import { ButtonArrow } from '../../ui/ButtonArrow';
import { Icon } from '../../ui/Icon';
import type { QuoteCopy } from './quote-copy';

export function QuoteTotal({
  copy,
  waitlistHref,
  pageHref,
  pageLabel,
}: {
  readonly copy: QuoteCopy;
  readonly waitlistHref: string;
  readonly pageHref: string;
  readonly pageLabel: string;
}) {
  return (
    <div className="picker-total">
      <div aria-live="polite" aria-atomic="true">
        <p className="picker-label">{copy.label}</p>
        <p className={copy.priced ? 'picker-price num' : 'picker-price picker-price-text'}>
          {copy.price}
        </p>
        {copy.lines.map((line) => (
          <p key={line} className="picker-break num">
            {line}
          </p>
        ))}
      </div>
      <div className="picker-cta">
        <a className="btn btn-primary" href={waitlistHref}>
          Join the waitlist
          <ButtonArrow />
        </a>
        <a className="text-link" href={pageHref}>
          {pageLabel}
          <Icon name="arrowRight" />
        </a>
      </div>
    </div>
  );
}
