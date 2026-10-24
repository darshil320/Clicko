import { CATEGORIES } from '../../content/categories';
import { LAUNCH_CITIES } from '../../content/cities';
import { CONTACT, LEGAL_LINKS, SITE } from '../../content/site';
import { LEGAL } from '../../legal/config';
import { paths } from '../../lib/routes';
import { BrandMark } from './BrandMark';

const DEFAULT_CITY = LAUNCH_CITIES[0];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div className="footer-about">
            <p className="footer-brand">
              <BrandMark />
              {SITE.name}
            </p>
            <p>
              On-demand professional photography. Live in Surat and Mumbai, pilot in Vadodara,
              waitlist everywhere else in India.
            </p>
            <a href={CONTACT.photographerApply}>Photographers: apply to join</a>
          </div>
          <nav aria-labelledby="footer-cities">
            <h2 id="footer-cities">Cities</h2>
            <ul>
              {LAUNCH_CITIES.map((city) => (
                <li key={city.slug}>
                  <a href={paths.cityHub(city)}>Photographers in {city.name}</a>
                </li>
              ))}
              <li>
                <a href={paths.cities}>All cities &amp; waitlist</a>
              </li>
            </ul>
          </nav>
          {DEFAULT_CITY ? (
            <nav aria-labelledby="footer-categories">
              <h2 id="footer-categories">Shoots in {DEFAULT_CITY.name}</h2>
              <ul>
                {CATEGORIES.map((category) => (
                  <li key={category.slug}>
                    <a href={paths.cityCategory(DEFAULT_CITY, category)}>{category.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <nav aria-labelledby="footer-legal">
            <h2 id="footer-legal">Legal</h2>
            <ul>
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="footer-legal">
          <p>
            © {new Date().getFullYear()} {LEGAL.entityName}. {LEGAL.brandName} is operated by{' '}
            {LEGAL.entityName}. Courts at {LEGAL.jurisdiction} have exclusive jurisdiction.
          </p>
          <p>
            Prices are exclusive of 18% GST (SAC 998383), shown with GST before you pay. Photography
            only; editing is a separate service.
          </p>
        </div>
      </div>
    </footer>
  );
}
