import { LAUNCH_CITIES, statusLabel, WAITLIST_EXAMPLES } from '../../content/cities';
import { paths } from '../../lib/routes';
import { Section } from '../ui/Section';

export function CityCards() {
  return (
    <ul className="grid grid-3">
      {LAUNCH_CITIES.map((city) => (
        <li key={city.slug} className="card">
          <span className={`badge ${city.status === 'LIVE' ? 'badge-live' : 'badge-pilot'}`}>
            {statusLabel(city.status)}
          </span>
          <h3>
            <a className="card-link" href={paths.cityHub(city)}>
              Photographers in {city.name}
            </a>
          </h3>
          <p className="muted">{city.summary}</p>
        </li>
      ))}
    </ul>
  );
}

export function CitiesServed() {
  return (
    <Section
      id="cities"
      eyebrow="Where we shoot"
      title="Live in Surat and Mumbai. Piloting in Vadodara."
      lead="The app works anywhere in India. Booking opens pincode by pincode, and the waitlist decides where we go next."
    >
      <CityCards />
      <div className="split split-gap">
        <div>
          <h3>Not in your city yet?</h3>
          <p className="muted">
            Join the waitlist with your pincode and we will tell you the day Clickco opens near you.
            Every other city is on the waitlist, including:
          </p>
          <ul className="chips" aria-label="Cities on the waitlist">
            {WAITLIST_EXAMPLES.map((name) => (
              <li key={name} className="chip">
                {name}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <a className="btn btn-secondary" href={`${paths.cities}#waitlist`}>
            Join the waitlist
          </a>
        </div>
      </div>
    </Section>
  );
}
