import { CATEGORIES } from '../../content/categories';
import { LAUNCH_CITIES } from '../../content/cities';
import { CATEGORY_UPLIFT_BPS } from '../../content/rate-card';
import { formatRupees } from '../../lib/money';
import { fromPrice } from '../../lib/pricing';
import { paths } from '../../lib/routes';
import { CATEGORY_MOOD, PhotoFrame } from '../ui/PhotoFrame';
import { Section } from '../ui/Section';

const surat = LAUNCH_CITIES[0];

export function Categories() {
  return (
    <Section
      id="categories"
      eyebrow="What we shoot"
      title={
        <>
          Seven kinds of shoot. <em>One way to book.</em>
        </>
      }
      lead="Each category is matched to photographers who know it. Prices below are 2-hour Basic shoots in Surat."
    >
      <ul className="grid grid-4 grid-feature">
        {CATEGORIES.map((category) => {
          const price = surat
            ? fromPrice('BASIC', surat.tier, CATEGORY_UPLIFT_BPS[category.code])
            : undefined;
          return (
            <li key={category.slug} className="card card-photo lift">
              <PhotoFrame mood={CATEGORY_MOOD[category.code]} />
              <div className="card-body">
                <h3>{category.label}</h3>
                <p className="muted">{category.summary}</p>
                {price ? (
                  <p className="price-note">From {formatRupees(price.basePaise)} + GST</p>
                ) : null}
                <ul
                  className="link-list push"
                  aria-label={`${category.label} photographers by city`}
                >
                  {LAUNCH_CITIES.map((city) => (
                    <li key={city.slug}>
                      <a href={paths.cityCategory(city, category)}>
                        <span className="sr-only">{category.label} photographers in </span>
                        {city.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
