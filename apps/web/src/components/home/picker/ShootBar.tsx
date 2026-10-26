'use client';

import { useEffect, useRef } from 'react';
import type { QuoteCopy } from './quote-copy';

/**
 * Phones only (ADR-0023): once the picker scrolls away, the chosen shoot and its price stay in a
 * bottom bar, like a cart. "Edit" returns to the picker; the button goes to the waitlist.
 */
export function ShootBar({
  visible,
  summary,
  copy,
  extra,
  pickerHref,
  waitlistHref,
}: {
  readonly visible: boolean;
  readonly summary: string;
  readonly copy: QuoteCopy;
  /** What the price leaves out, e.g. video that is priced in the app. */
  readonly extra?: string;
  readonly pickerHref: string;
  readonly waitlistHref: string;
}) {
  const bar = useRef<HTMLElement>(null);

  // Hiding makes the bar inert; never strand keyboard focus inside it. Hand it to the picker.
  useEffect(() => {
    if (visible || !bar.current?.contains(document.activeElement)) return;
    const picker = document.querySelector<HTMLElement>(`${pickerHref} input:checked`);
    picker?.focus({ preventScroll: true });
  }, [visible, pickerHref]);

  return (
    <section
      ref={bar}
      className="shoot-bar"
      aria-label="Your shoot"
      data-visible={visible}
      inert={!visible}
    >
      <a className="shoot-bar-summary" href={pickerHref}>
        <span className="shoot-bar-what">{summary}</span>
        <span className={copy.priced ? 'shoot-bar-price num' : 'shoot-bar-price'}>
          {copy.price}
          {extra ? <span className="shoot-bar-extra">{extra}</span> : null}
          <span className="shoot-bar-edit">Edit</span>
        </span>
      </a>
      <a className="btn btn-primary btn-sm" href={waitlistHref}>
        Join waitlist
      </a>
    </section>
  );
}
