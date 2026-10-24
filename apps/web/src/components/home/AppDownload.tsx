import { Icon } from '../ui/Icon';

const STORES = ['App Store', 'Google Play'] as const;

/** Closing call to action. Store badges are text until the listings exist (PLAN S12): nowhere to link yet. */
export function AppDownload() {
  return (
    <section id="app" className="section" aria-labelledby="app-title">
      <div className="wrap">
        <div className="cta-panel reveal">
          <p className="eyebrow">The Clickco app</p>
          <h2 id="app-title">Booking happens in the app</h2>
          <p className="lead">
            Choose a plan, see the full price with GST, pay securely and follow your booking from
            confirmation to delivery. The app is on its way to the stores.
          </p>
          <ul className="store-badges" aria-label="App downloads">
            {STORES.map((store) => (
              <li key={store} className="store-badge">
                <Icon name="phone" />
                <span>
                  <small>Coming soon</small>
                  {store}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
