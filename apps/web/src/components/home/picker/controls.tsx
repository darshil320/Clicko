'use client';

import { type ReactNode, useRef } from 'react';
import type { CategoryCode } from '../../../content/rate-card';
import { categoryGlyph } from '../../ui/CategoryIcon';
import { Icon } from '../../ui/Icon';
import type { PickerCategory, PickerTier } from './types';

export function CategoryTiles({
  name,
  categories,
  value,
  onChange,
}: {
  readonly name: string;
  readonly categories: readonly PickerCategory[];
  readonly value: CategoryCode;
  readonly onChange: (code: CategoryCode) => void;
}) {
  const warmed = useRef(new Set<string>());
  /** Fetch a photo on hover or focus, so choosing its category swaps without a blank frame. */
  const warm = (src: string) => {
    if (warmed.current.has(src)) return;
    warmed.current.add(src);
    new Image().src = src;
  };
  return (
    <div role="radiogroup" aria-labelledby={`${name}-label`}>
      <p id={`${name}-label`} className="picker-title">
        What are you shooting?
      </p>
      <div className="cat-tiles">
        {categories.map((c) => (
          <label key={c.code} className="cat-tile" onPointerEnter={() => warm(c.photo.src)}>
            <input
              type="radio"
              name={name}
              value={c.code}
              checked={c.code === value}
              onChange={() => onChange(c.code)}
              onFocus={() => warm(c.photo.src)}
            />
            <Icon name={categoryGlyph(c.code)} />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** A labelled row of radios drawn as a segmented control (styles: `.seg`). */
export function Segmented<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
  wide = false,
}: {
  readonly name: string;
  readonly label: string;
  readonly options: readonly { readonly value: T; readonly label: ReactNode }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Four or more options: two by two on phones. */
  readonly wide?: boolean;
}) {
  return (
    <div className="picker-row" role="radiogroup" aria-labelledby={`${name}-label`}>
      <span id={`${name}-label`} className="picker-label">
        {label}
      </span>
      <div className={wide ? 'seg seg-wide' : 'seg'}>
        {options.map((option) => (
          <label key={option.value} className="seg-opt">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function TierLabel({
  tier,
  category,
}: {
  readonly tier: PickerTier;
  readonly category: PickerCategory;
}) {
  if (tier.code !== category.recommended) return <>{tier.label}</>;
  return (
    <>
      {tier.label}
      <span className="seg-rec" aria-hidden="true" />
      <span className="sr-only">, recommended for {category.label}</span>
    </>
  );
}

export function HoursStepper({
  id,
  value,
  range,
  onChange,
}: {
  readonly id: string;
  readonly value: number;
  readonly range: { readonly min: number; readonly max: number };
  readonly onChange: (hours: number) => void;
}) {
  return (
    <div className="picker-row">
      <span id={`${id}-label`} className="picker-label">
        Hours
      </span>
      <div className="stepper">
        <button
          type="button"
          aria-label="One hour less"
          aria-disabled={value <= range.min}
          onClick={() => onChange(Math.max(range.min, value - 1))}
        >
          <Icon name="minus" />
        </button>
        {/* The quote below announces each change; the count itself stays quiet. */}
        <output className="num" aria-labelledby={`${id}-label`} aria-live="off">
          {value} hours
        </output>
        <button
          type="button"
          aria-label="One hour more"
          aria-disabled={value >= range.max}
          onClick={() => onChange(Math.min(range.max, value + 1))}
        >
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}
