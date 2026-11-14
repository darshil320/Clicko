-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0021 · quantity-tier add-on prices (ADR-0034, the
-- owner's videography rate card). Additive only: every existing row keeps its
-- meaning through the defaults.
--
--   addon_prices
--     + min_quantity  the row applies when the booking takes at least this
--                     many units, and its unit price then covers EVERY unit
--                     (reels: ₹3,000 each; from 5 reels, ₹2,000 each for all
--                     of them). 1 = the ordinary price, so every existing row
--                     prices exactly as before. Part of the unique key, so one
--                     (ruleset, add-on, tier, city tier) can hold several
--                     quantity breaks.
--
--   addons (the catalogue, like min_tier)
--     + max_quantity       the most units one booking may take. 4 is what the
--                          API contract allowed for every add-on until now.
--     + requires_addon_id  another add-on that must be on the same booking
--                          (reels and raw footage need the videographer).
--                          NULL = stands alone.
-- ============================================================================

ALTER TABLE addon_prices
  ADD COLUMN min_quantity smallint NOT NULL DEFAULT 1,
  ADD CONSTRAINT addon_price_min_quantity CHECK (min_quantity >= 1);

DROP INDEX addon_prices_uq;
CREATE UNIQUE INDEX addon_prices_uq
  ON addon_prices (ruleset_id, addon_id,
                   coalesce(tier, 'BASIC'::plan_tier),
                   coalesce(city_tier, 'METRO'::city_tier),
                   min_quantity);

ALTER TABLE addons
  ADD COLUMN max_quantity smallint NOT NULL DEFAULT 4,
  ADD COLUMN requires_addon_id uuid REFERENCES addons(id),
  ADD CONSTRAINT addon_max_quantity CHECK (max_quantity >= 1),
  ADD CONSTRAINT addon_requires_other CHECK (requires_addon_id <> id);
