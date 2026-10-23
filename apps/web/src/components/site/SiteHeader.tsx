import { PRIMARY_NAV, SITE } from '../../content/site';

export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="wrap bar">
        <a className="brand" href="/" aria-label={`${SITE.name} home`}>
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
      </div>
    </header>
  );
}
