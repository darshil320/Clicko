import type { ReactNode } from 'react';
import { CATEGORIES, type Category } from '../../content/categories';
import { LAUNCH_CITIES, type LaunchCity, statusLabel } from '../../content/cities';
import { CATEGORY_UPLIFT_BPS } from '../../content/rate-card';
import type { Crumb } from '../../lib/jsonld';
import { formatRupees } from '../../lib/money';
import { fromPrice } from '../../lib/pricing';
import { paths } from '../../lib/routes';
import { Breadcrumbs } from '../ui/Breadcrumbs';
import { Icon, IconChip } from '../ui/Icon';
import { CATEGORY_MOOD, PhotoFrame, type PhotoMood } from '../ui/PhotoFrame';

export function StatusBadge({ city }: { readonly city: LaunchCity }) {
  return (
    <span className={`badge ${city.status === 'LIVE' ? 'badge-live' : 'badge-pilot'}`}>
      {statusLabel(city.status)}
    </span>
  );
}

export function PageHero({
  crumbs,
  city,
  title,
  mood,
  caption,
  children,
}: {
  readonly crumbs: readonly Crumb[];
  readonly city: LaunchCity;
  readonly title: string;
  /** The hero photograph's placeholder light (ADR-0018: every section carries a photo). */
  readonly mood: PhotoMood;
  readonly caption: string;
  readonly children: ReactNode;
}) {
  return (
    <header className="page-hero">
      <div className="wrap page-hero-grid">
        <div>
          <Breadcrumbs crumbs={crumbs} />
          <StatusBadge city={city} />
          <h1>{title}</h1>
          <div className="prose-block">{children}</div>
        </div>
        <PhotoFrame mood={mood} caption={caption} corners />
      </div>
    </header>
  );
}

/** Areas, festival pricing and pilot status for one city. */
export function CityNotes({ city }: { readonly city: LaunchCity }) {
  return (
    <div className="card">
      <IconChip name="mapPin" />
      <h3>Good to know in {city.name}</h3>
      <p className="muted">
        Areas we shoot in include {city.areas.slice(0, -1).join(', ')} and {city.areas.at(-1)}.
        Coverage is confirmed by pincode in the app before you book.
      </p>
      <p className="muted">{city.festivals} The app shows exact dates before you pay.</p>
      {city.status === 'PILOT' ? (
        <p className="muted">
          {city.name} is in pilot. Prices follow the same rate card as our live cities, but with
          fewer photographers it can take longer to confirm yours, so book early.
        </p>
      ) : null}
    </div>
  );
}

/** The seven category cards for one city, each with its Basic "from" price. */
export function CategoryLinks({
  city,
  exclude,
}: {
  readonly city: LaunchCity;
  readonly exclude?: Category['slug'];
}) {
  const shown = CATEGORIES.filter((category) => category.slug !== exclude);
  // Seven cards use the feature grid (one wide card fills the gap); six sit evenly in threes.
  const grid = shown.length % 2 === 1 ? 'grid grid-4 grid-feature' : 'grid grid-3';
  return (
    <ul className={grid}>
      {shown.map((category) => {
        const price = fromPrice('BASIC', city.tier, CATEGORY_UPLIFT_BPS[category.code]);
        return (
          <li key={category.slug} className="card card-photo lift">
            <PhotoFrame mood={CATEGORY_MOOD[category.code]} />
            <div className="card-body">
              <h3>
                <a className="card-link" href={paths.cityCategory(city, category)}>
                  {category.label} photography
                </a>
              </h3>
              <p className="muted">{category.summary}</p>
              <p className="price-note push">From {formatRupees(price.basePaise)} + GST</p>
              <span className="card-arrow" aria-hidden="true">
                <Icon name="arrowRight" />
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Same category in the other launch cities. */
export function OtherCities({
  current,
  category,
}: {
  readonly current: LaunchCity;
  readonly category?: Category;
}) {
  const others = LAUNCH_CITIES.filter((city) => city.slug !== current.slug);
  return (
    <ul className="link-list">
      {others.map((city) => (
        <li key={city.slug}>
          <a href={category ? paths.cityCategory(city, category) : paths.cityHub(city)}>
            {category
              ? `${category.label} photographers in ${city.name}`
              : `Photographers in ${city.name}`}
          </a>
        </li>
      ))}
    </ul>
  );
}
