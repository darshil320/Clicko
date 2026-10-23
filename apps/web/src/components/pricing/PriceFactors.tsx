import { CATEGORIES } from '../../content/categories';
import { CATEGORY_UPLIFT_BPS, LEAD_TIME_BANDS, PRICE_FACTORS } from '../../content/rate-card';
import { percentAbove } from '../../lib/pricing';

const shortest = LEAD_TIME_BANDS[LEAD_TIME_BANDS.length - 1];
const nextDay = LEAD_TIME_BANDS[1];

/** Everything that moves a quote away from the "from" price, stated up front. */
export function PriceFactors() {
  const categoryLines = CATEGORIES.filter((c) => CATEGORY_UPLIFT_BPS[c.code] > 10_000).map(
    (c) => `${c.label} ${percentAbove(CATEGORY_UPLIFT_BPS[c.code])}`,
  );
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Category', categoryLines.join(' · ')],
    ['Weekend (Sat, Sun)', percentAbove(PRICE_FACTORS.weekendBps)],
    ['Night start (10 pm – 6 am)', percentAbove(PRICE_FACTORS.nightBps)],
    [
      'Festival dates & wedding season',
      `${percentAbove(PRICE_FACTORS.festivalMinBps)} to ${percentAbove(PRICE_FACTORS.festivalMaxBps)}`,
    ],
    [
      'Short notice (under 48 hours)',
      nextDay && shortest
        ? `${percentAbove(nextDay.multiplierBps)} to ${percentAbove(shortest.multiplierBps)}`
        : '',
    ],
    ['Travel beyond 15 km, add-ons', 'Itemised in your quote'],
  ];
  return (
    <div>
      <h3>What changes the price</h3>
      <p className="muted">
        “From” prices are for a weekday daytime shoot booked more than two days ahead. These adjust
        the photography fee; add-ons and travel are never multiplied. The app shows the full price,
        with GST, before you pay.
      </p>
      <ul className="factor-list">
        {rows.map(([label, value]) => (
          <li key={label}>
            <span>{label}</span>
            <span>{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
