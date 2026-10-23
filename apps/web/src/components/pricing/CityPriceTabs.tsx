'use client';

import { type KeyboardEvent, useRef, useState } from 'react';
import type { PriceCardData } from '../../lib/pricing';
import { TierGrid } from './TierCards';

export interface CityPrices {
  readonly slug: string;
  readonly name: string;
  readonly hubPath: string;
  readonly note: string;
  readonly cards: readonly PriceCardData[];
}

/**
 * City switcher for the home-page rate card (WAI-ARIA tabs, automatic activation).
 * Without JavaScript the first city (Surat) stays visible and every panel links to its hub.
 */
export function CityPriceTabs({ cities }: { readonly cities: readonly CityPrices[] }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const next = (index + cities.length) % cities.length;
    setActive(next);
    tabs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: cities.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Choose a city">
        {cities.map((city, index) => (
          <button
            key={city.slug}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`price-tab-${city.slug}`}
            className="tab"
            aria-selected={index === active}
            aria-controls={`price-panel-${city.slug}`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={onKeyDown}
          >
            {city.name}
          </button>
        ))}
      </div>
      {cities.map((city, index) => (
        <div
          key={city.slug}
          role="tabpanel"
          id={`price-panel-${city.slug}`}
          aria-labelledby={`price-tab-${city.slug}`}
          hidden={index !== active}
        >
          <TierGrid cards={city.cards} label={`Prices in ${city.name}`} />
          <p className="section-foot">
            {city.note} <a href={city.hubPath}>See all {city.name} shoots</a>
          </p>
        </div>
      ))}
    </div>
  );
}
