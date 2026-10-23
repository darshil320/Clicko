import type { Metadata } from 'next';
import { LAUNCH_CITIES } from '../src/content/cities';
import { paths } from '../src/lib/routes';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="page">
      <section className="hero" aria-labelledby="not-found-title">
        <div className="wrap">
          <p className="eyebrow">Error 404</p>
          <h1 id="not-found-title">This frame didn’t make the cut.</h1>
          <p className="lead">
            The page you are looking for has moved or never existed. Try one of these instead.
          </p>
          <div className="actions">
            <a className="btn btn-primary" href={paths.home}>
              Go to the home page
            </a>
            <a className="btn btn-secondary" href={paths.cities}>
              See our cities
            </a>
          </div>
          <ul className="link-list section-foot">
            {LAUNCH_CITIES.map((city) => (
              <li key={city.slug}>
                <a href={paths.cityHub(city)}>Photographers in {city.name}</a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
