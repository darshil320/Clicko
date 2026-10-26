'use client';

import { type ReactNode, useCallback, useId, useRef, useState } from 'react';
import { MEDIA_OPTIONS, type ShootMedia } from '../../content/moments';
import type { SiteReel } from '../../content/reels';
import { quoteFor } from '../../lib/pricing';
import { CATEGORY_MOOD, PhotoFrame } from '../ui/PhotoFrame';
import { ReelVideo } from '../ui/ReelVideo';
import { CategoryTiles, HoursStepper, Segmented, TierLabel } from './picker/controls';
import { useHydrated, usePrefill, useScrolledPast } from './picker/hooks';
import { QuoteTotal } from './picker/QuoteTotal';
import { describeQuote } from './picker/quote-copy';
import { ShootBar } from './picker/ShootBar';
import type { PickerCategory, PickerCity, PickerTier, Shoot, ShootPreset } from './picker/types';

const PICKER_ID = 'book';

interface HeroPickerProps {
  readonly categories: readonly PickerCategory[];
  readonly cities: readonly PickerCity[];
  readonly tiers: readonly PickerTier[];
  readonly hours: { readonly min: number; readonly max: number };
  readonly initial: Shoot;
  /** Moment presets by id, for `#shoot-<id>` links. */
  readonly presets: Readonly<Record<string, ShootPreset>>;
  /** The hero reel and every moment's reel, by name. */
  readonly reels: Readonly<Record<string, SiteReel>>;
  readonly waitlistHref: string;
  /** Kicker and headline, rendered on the server above the picker. */
  readonly children: ReactNode;
  /** Proof points under the photo. */
  readonly aside: ReactNode;
}

/**
 * The home hero's shoot picker (ADR-0019, ADR-0023): photos, video or both, then category, city,
 * hours and level. Photo prices come live from the rate card; video is priced in the app. Without
 * JavaScript the opening quote is shown and the controls stay disabled, so a choice never sits
 * beside a price that does not match it.
 */
export function HeroPicker({
  categories,
  cities,
  tiers,
  hours,
  initial,
  ...rest
}: HeroPickerProps) {
  const id = useId();
  const [shoot, setShoot] = useState(initial);
  const hydrated = useHydrated();
  const picker = useRef<HTMLFormElement>(null);
  const update = (patch: Partial<Shoot>) => setShoot((current) => ({ ...current, ...patch }));
  const applyPreset = useCallback(
    (preset: ShootPreset) => setShoot((current) => ({ ...current, ...preset })),
    [],
  );
  usePrefill(rest.presets, applyPreset, picker, PICKER_ID);
  const barVisible = useScrolledPast(picker, 'waitlist');

  const category = categories.find((c) => c.code === shoot.category) ?? categories[0];
  const city = cities.find((c) => c.slug === shoot.city) ?? cities[0];
  if (!category || !city) return null;
  const copy = describeQuote(
    shoot.media,
    quoteFor(shoot.tier, city.tier, category.code, shoot.hours),
  );
  const media = MEDIA_OPTIONS.find((m) => m.value === shoot.media)?.label ?? '';

  return (
    <div className="wrap hero-grid">
      <div className="hero-head">{rest.children}</div>
      <form
        id={PICKER_ID}
        ref={picker}
        className="picker"
        aria-label="Price your shoot"
        onSubmit={(e) => e.preventDefault()}
      >
        <fieldset className="picker-controls" disabled={!hydrated}>
          <Segmented<ShootMedia>
            name={`${id}-media`}
            label="Capture"
            options={MEDIA_OPTIONS}
            value={shoot.media}
            onChange={(value) => update({ media: value })}
          />
          <CategoryTiles
            name={`${id}-category`}
            categories={categories}
            value={category.code}
            onChange={(code) =>
              update({
                category: code,
                reel: categories.find((c) => c.code === code)?.reel ?? initial.reel,
              })
            }
          />
          <div className="picker-rows">
            <Segmented
              name={`${id}-city`}
              label="City"
              options={cities.map((c) => ({ value: c.slug, label: c.name }))}
              value={city.slug}
              onChange={(slug) => update({ city: slug })}
            />
            <HoursStepper
              id={`${id}-hours`}
              value={shoot.hours}
              range={hours}
              onChange={(value) => update({ hours: value })}
            />
            <Segmented
              name={`${id}-tier`}
              label="Pro level"
              options={tiers.map((t) => ({
                value: t.code,
                label: <TierLabel tier={t} category={category} />,
              }))}
              value={shoot.tier}
              onChange={(tier) => update({ tier })}
              wide
            />
          </div>
        </fieldset>
        <QuoteTotal
          copy={copy}
          waitlistHref={rest.waitlistHref}
          pageHref={city.links[category.code]}
          pageLabel={`${category.label} shoots in ${city.name}`}
        />
        <p className="picker-note">
          Photo prices: weekday daytime, booked 2+ days ahead. 50% to book, the rest after the
          shoot.
          {city.pilot ? ` ${city.name} is a pilot city: book a few days ahead.` : null}
        </p>
      </form>
      <div className="hero-visual">
        <HeroVisual shoot={shoot} category={category} reels={rest.reels} fallback={initial.reel} />
        {rest.aside}
      </div>
      <ShootBar
        visible={barVisible}
        summary={`${media} · ${category.label} · ${city.name} · ${shoot.hours} h`}
        copy={copy}
        extra={shoot.media === 'BOTH' ? '+ video in app' : undefined}
        pickerHref={`#${PICKER_ID}`}
        waitlistHref={rest.waitlistHref}
      />
    </div>
  );
}

/** Photos show the category's photo; anything with video plays a sample reel. */
function HeroVisual({
  shoot,
  category,
  reels,
  fallback,
}: {
  readonly shoot: Shoot;
  readonly category: PickerCategory;
  readonly reels: Readonly<Record<string, SiteReel>>;
  readonly fallback: string;
}) {
  const reel = reels[shoot.reel] ?? reels[fallback];
  if (shoot.media === 'PHOTO' || !reel) {
    return (
      <PhotoFrame
        key={category.code}
        mood={CATEGORY_MOOD[category.code]}
        src={category.photo.src}
        alt={category.photo.alt}
        caption={`${category.label} · sample photo`}
        className="hero-photo"
        priority
      />
    );
  }
  return (
    <ReelVideo key={reel.name} reel={reel} caption="Sample reel" className="hero-photo" priority />
  );
}
