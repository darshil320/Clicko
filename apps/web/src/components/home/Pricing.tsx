import { LAUNCH_CITIES, statusLabel } from '../../content/cities';
import { NOT_INCLUDED } from '../../content/tiers';
import { categoryFromPrices, toCardData } from '../../lib/pricing';
import { paths } from '../../lib/routes';
import { type CityPrices, CityPriceTabs } from '../pricing/CityPriceTabs';
import { PriceFactors } from '../pricing/PriceFactors';
import { Section } from '../ui/Section';

const CITY_PRICES: readonly CityPrices[] = LAUNCH_CITIES.map((city) => ({
  slug: city.slug,
  name: city.name,
  hubPath: paths.cityHub(city),
  note: `${city.name} — ${statusLabel(city.status)}. Prices shown for portrait and event shoots.`,
  cards: categoryFromPrices(city.tier).map(toCardData),
}));

export function Pricing() {
  return (
    <Section
      id="pricing"
      raised
      eyebrow="Pricing"
      title="Clear prices, before you book"
      lead="Every plan starts at 2 hours. Prices are exclusive of 18% GST, and the GST-inclusive total is always shown right beside them."
    >
      <CityPriceTabs cities={CITY_PRICES} />
      <div className="split split-gap">
        <PriceFactors />
        <div>
          <h3>Not included in any plan</h3>
          <ul className="checklist checklist-out">
            {NOT_INCLUDED.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="muted">
            Clickco Edit — professional retouching of your best frames — can be added after
            delivery, with its own 5–7 day turnaround.
          </p>
        </div>
      </div>
    </Section>
  );
}
