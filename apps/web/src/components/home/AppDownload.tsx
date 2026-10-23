import { Section } from '../ui/Section';

const STORES = ['App Store', 'Google Play'] as const;

/** Store badges as text until the listings exist (PLAN S12). Not links: there is nowhere to go yet. */
export function AppDownload() {
  return (
    <Section
      id="app"
      eyebrow="The Clickco app"
      title="Booking happens in the app"
      lead="Choose a plan, see the full price with GST, pay securely and follow your booking from confirmation to delivery. The app is on its way to the stores."
    >
      <ul className="store-badges" aria-label="App downloads">
        {STORES.map((store) => (
          <li key={store} className="store-badge">
            <small>Coming soon</small>
            {store}
          </li>
        ))}
      </ul>
    </Section>
  );
}
