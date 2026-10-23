import type { ReactNode } from 'react';
import { CATEGORIES, type Category } from '../../content/categories';
import { LAUNCH_CITIES, type LaunchCity, statusLabel } from '../../content/cities';
import { CATEGORY_UPLIFT_BPS } from '../../content/rate-card';
import type { Crumb } from '../../lib/jsonld';
import { formatRupees } from '../../lib/money';
import { fromPrice } from '../../lib/pricing';
import { paths } from '../../lib/routes';
import { Breadcrumbs } from '../ui/Breadcrumbs';

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
  children,
}: {
  readonly crumbs: readonly Crumb[];
  readonly city: LaunchCity;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <header className="page-hero">
      <div className="wrap">
        <Breadcrumbs crumbs={crumbs} />
        <StatusBadge city={city} />
        <h1>{title}</h1>
        <div className="prose-block">{children}</div>
      </div>
    </header>
  );
}

/** Areas, festival pricing and pilot status for one city. */
export function CityNotes({ city }: { readonly city: LaunchCity }) {
  return (
    <div className="card">
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
  return (
    <ul className="grid grid-4">
      {CATEGORIES.filter((category) => category.slug !== exclude).map((category) => {
        const price = fromPrice('BASIC', city.tier, CATEGORY_UPLIFT_BPS[category.code]);
        return (
          <li key={category.slug} className="card">
            <h3>
              <a className="card-link" href={paths.cityCategory(city, category)}>
                {category.label} photography
              </a>
            </h3>
            <p className="muted">{category.summary}</p>
            <p className="price-note push">From {formatRupees(price.basePaise)} + GST</p>
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
