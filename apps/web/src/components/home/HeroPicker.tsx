'use client';

import { type ReactNode, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { SitePhoto } from '../../content/photos';
import type { BookableTier, CategoryCode, LaunchCityTier } from '../../content/rate-card';
import { type Quote, quoteFor } from '../../lib/pricing';
import { ButtonArrow } from '../ui/ButtonArrow';
import { categoryGlyph } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { CATEGORY_MOOD, PhotoFrame } from '../ui/PhotoFrame';

export interface PickerCategory {
  readonly code: CategoryCode;
  readonly label: string;
  readonly recommended: BookableTier;
  readonly photo: SitePhoto;
}

export interface PickerCity {
  readonly slug: string;
  readonly name: string;
  readonly tier: LaunchCityTier;
  readonly pilot: boolean;
  /** This city's page for each category. */
  readonly links: Readonly<Record<CategoryCode, string>>;
}

export interface PickerTier {
  readonly code: BookableTier;
  readonly label: string;
}

interface HeroPickerProps {
  readonly categories: readonly PickerCategory[];
  readonly cities: readonly PickerCity[];
  readonly tiers: readonly PickerTier[];
  readonly hours: { readonly min: number; readonly max: number };
  readonly defaultTier: BookableTier;
  readonly waitlistHref: string;
  /** Kicker and headline, rendered on the server above the picker. */
  readonly children: ReactNode;
  /** Proof points under the photo. */
  readonly aside: ReactNode;
}

/**
 * The home hero's shoot picker (ADR-0019): category, city, hours and tier give the real price
 * from the rate card as you choose, and the photo follows the category. Without JavaScript the
 * opening quote is shown and the controls stay disabled, so a choice never sits beside a price
 * that does not match it.
 */
export function HeroPicker({
  categories,
  cities,
  tiers,
  hours,
  defaultTier,
  ...rest
}: HeroPickerProps) {
  const id = useId();
  const [categoryCode, setCategoryCode] = useState(categories[0]?.code);
  const [citySlug, setCitySlug] = useState(cities[0]?.slug);
  const [tier, setTier] = useState(defaultTier);
  const [hourCount, setHourCount] = useState(hours.min);
  const hydrated = useHydrated();

  const category = categories.find((c) => c.code === categoryCode) ?? categories[0];
  const city = cities.find((c) => c.slug === citySlug) ?? cities[0];
  if (!category || !city) return null;

  const tierOptions = tiers.map((t) => ({
    value: t.code,
    label: <TierLabel tier={t} category={category} />,
  }));

  return (
    <div className="wrap hero-grid">
      <div className="hero-head">{rest.children}</div>
      <form className="picker" aria-label="Price your shoot" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="picker-controls" disabled={!hydrated}>
          <CategoryTiles
            name={`${id}-category`}
            categories={categories}
            value={category.code}
            onChange={setCategoryCode}
          />
          <div className="picker-rows">
            <Segmented
              name={`${id}-city`}
              label="City"
              options={cities.map((c) => ({ value: c.slug, label: c.name }))}
              value={city.slug}
              onChange={setCitySlug}
            />
            <HoursStepper
              id={`${id}-hours`}
              value={hourCount}
              range={hours}
              onChange={setHourCount}
            />
            <Segmented
              name={`${id}-tier`}
              label="Photographer"
              options={tierOptions}
              value={tier}
              onChange={setTier}
              wide
            />
          </div>
        </fieldset>
        <QuoteTotal
          quote={quoteFor(tier, city.tier, category.code, hourCount)}
          waitlistHref={rest.waitlistHref}
          pageHref={city.links[category.code]}
          pageLabel={`${category.label} shoots in ${city.name}`}
        />
        <p className="picker-note">
          Weekday daytime, booked 2+ days ahead. 50% to book, the rest after the shoot.
          {city.pilot ? ` ${city.name} is a pilot city: book a few days ahead.` : null}
        </p>
      </form>
      <div className="hero-visual">
        <PhotoFrame
          key={category.code}
          mood={CATEGORY_MOOD[category.code]}
          src={category.photo.src}
          alt={category.photo.alt}
          caption={`${category.label} · sample photo`}
          className="hero-photo"
          priority
        />
        {rest.aside}
      </div>
    </div>
  );
}

const noSubscription = () => () => {};

/** False on the server and while hydrating; true once React runs in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

function CategoryTiles({
  name,
  categories,
  value,
  onChange,
}: {
  readonly name: string;
  readonly categories: readonly PickerCategory[];
  readonly value: CategoryCode;
  readonly onChange: (code: CategoryCode) => void;
}) {
  const warmed = useRef(new Set<string>());
  /** Fetch a photo on hover or focus, so choosing its category swaps without a blank frame. */
  const warm = (src: string) => {
    if (warmed.current.has(src)) return;
    warmed.current.add(src);
    new Image().src = src;
  };
  return (
    <div role="radiogroup" aria-labelledby={`${name}-label`}>
      <p id={`${name}-label`} className="picker-title">
        What are you shooting?
      </p>
      <div className="cat-tiles">
        {categories.map((c) => (
          <label key={c.code} className="cat-tile" onPointerEnter={() => warm(c.photo.src)}>
            <input
              type="radio"
              name={name}
              value={c.code}
              checked={c.code === value}
              onChange={() => onChange(c.code)}
              onFocus={() => warm(c.photo.src)}
            />
            <Icon name={categoryGlyph(c.code)} />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** A labelled row of radios drawn as a segmented control (styles: `.seg`). */
function Segmented<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
  wide = false,
}: {
  readonly name: string;
  readonly label: string;
  readonly options: readonly { readonly value: T; readonly label: ReactNode }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Four or more options: two by two on phones. */
  readonly wide?: boolean;
}) {
  return (
    <div className="picker-row" role="radiogroup" aria-labelledby={`${name}-label`}>
      <span id={`${name}-label`} className="picker-label">
        {label}
      </span>
      <div className={wide ? 'seg seg-wide' : 'seg'}>
        {options.map((option) => (
          <label key={option.value} className="seg-opt">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function TierLabel({
  tier,
  category,
}: {
  readonly tier: PickerTier;
  readonly category: PickerCategory;
}) {
  if (tier.code !== category.recommended) return <>{tier.label}</>;
  return (
    <>
      {tier.label}
      <span className="seg-rec" aria-hidden="true" />
      <span className="sr-only">, recommended for {category.label}</span>
    </>
  );
}

function HoursStepper({
  id,
  value,
  range,
  onChange,
}: {
  readonly id: string;
  readonly value: number;
  readonly range: { readonly min: number; readonly max: number };
  readonly onChange: (hours: number) => void;
}) {
  return (
    <div className="picker-row">
      <span id={`${id}-label`} className="picker-label">
        Hours
      </span>
      <div className="stepper">
        <button
          type="button"
          aria-label="One hour less"
          aria-disabled={value <= range.min}
          onClick={() => onChange(Math.max(range.min, value - 1))}
        >
          <Icon name="minus" />
        </button>
        {/* The quote below announces each change; the count itself stays quiet. */}
        <output className="num" aria-labelledby={`${id}-label`} aria-live="off">
          {value} hours
        </output>
        <button
          type="button"
          aria-label="One hour more"
          aria-disabled={value >= range.max}
          onClick={() => onChange(Math.min(range.max, value + 1))}
        >
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}

function QuoteTotal({
  quote,
  waitlistHref,
  pageHref,
  pageLabel,
}: {
  readonly quote: Quote;
  readonly waitlistHref: string;
  readonly pageHref: string;
  readonly pageLabel: string;
}) {
  return (
    <div className="picker-total">
      <div aria-live="polite" aria-atomic="true">
        <p className="picker-label">You pay</p>
        <p className="picker-price num">{quote.total}</p>
        <p className="picker-break num">
          {quote.base} + {quote.gst} GST · {quote.frames} delivered frames
        </p>
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
