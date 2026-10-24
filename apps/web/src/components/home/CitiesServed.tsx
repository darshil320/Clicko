import { LAUNCH_CITIES, statusLabel, WAITLIST_EXAMPLES } from '../../content/cities';
import { paths } from '../../lib/routes';
import { Icon } from '../ui/Icon';
import { PhotoFrame, type PhotoMood } from '../ui/PhotoFrame';
import { Section } from '../ui/Section';

/** How many example neighbourhoods a city card lists. */
const AREAS_SHOWN = 4;

/** Placeholder light per launch city until real city photographs exist. */
const CITY_MOOD: Readonly<Record<string, PhotoMood>> = {
  surat: 'golden',
  mumbai: 'coast',
  vadodara: 'garden',
};

export function CityCards() {
  return (
    <ul className="grid grid-3">
      {LAUNCH_CITIES.map((city) => (
        <li key={city.slug} className="card card-photo lift city-card">
          <PhotoFrame mood={CITY_MOOD[city.slug] ?? 'golden'} caption={city.name} />
          <div className="card-body">
            <span className={`badge ${city.status === 'LIVE' ? 'badge-live' : 'badge-pilot'}`}>
              {statusLabel(city.status)}
            </span>
            <h3>
              <a className="card-link" href={paths.cityHub(city)}>
                Photographers in {city.name}
              </a>
            </h3>
            <p className="muted">{city.summary}</p>
            <p className="city-areas push">
              <Icon name="mapPin" />
              {city.areas.slice(0, AREAS_SHOWN).join(' · ')}
            </p>
            <span className="card-arrow" aria-hidden="true">
              <Icon name="arrowRight" />
            </span>
          </div>
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
      title={
        <>
          Live in Surat and Mumbai. <em>Piloting in Vadodara.</em>
        </>
      }
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
                <Icon name="mapPin" />
                {name}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <a className="btn btn-secondary" href="#waitlist">
            Join the waitlist
            <Icon name="arrowRight" />
          </a>
        </div>
      </div>
    </Section>
  );
}
