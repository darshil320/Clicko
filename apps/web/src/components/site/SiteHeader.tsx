import { PRIMARY_NAV, SITE } from '../../content/site';
import { paths } from '../../lib/routes';
import { BrandMark } from './BrandMark';

export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="wrap bar">
        <a className="brand" href={paths.home} aria-label={`${SITE.name} home`}>
          <BrandMark />
          {SITE.name}
        </a>
        <nav className="site-nav" aria-label="Primary">
          <ul className="nav-list">
            {PRIMARY_NAV.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <a className="btn btn-dark btn-sm header-cta" href={`${paths.cities}#waitlist`}>
          Join the waitlist
        </a>
      </div>
    </header>
  );
}
