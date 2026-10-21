---

name: clickco-money
description: How Clickco represents and computes money. Load whenever code touches an amount, price, total, payout, GST, refund, or ledger entry.
---

# Money in Clickco

## Representation

Integer paise. Always. ₹8,500.00 is `850000`.
- Postgres: BIGINT
- TypeScript arithmetic: `bigint` only (`roundHalfUp`, `ceilHalf` from @clickco/utils)
- On the wire (ADR-0007, closes SPEC-AUDIT SA-03):
  - single amount → `MoneyPaise` from @clickco/contracts
    (`z.number().int().safe().nonnegative().max(MAX_MONEY_PAISE)`, ₹100 crore ceiling)
  - signed delta (ledger line, discount) → `SignedMoneyPaise`
  - aggregate (ledger sums, payout batch totals, reports) → `MoneyPaiseString`
    (decimal string, parsed to bigint). Aggregates never travel as JS numbers.
- Convert at the edge with `toPaiseBigint()` / `fromPaiseBigint()` from @clickco/utils.

Never: float, DECIMAL, NUMERIC, parseFloat, toFixed, or a decimal literal.

## Percentages

Integer basis points. 18% is `1800`. 62.5% is `6250`.

## Rounding

One function, from @clickco/utils:

```ts
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (2n * denominator);
}
```

Half-up, not banker's. Round once per line item, then sum. Never round a total
after summing unrounded lines.

## GST

Exclusive by default (`pricing_rulesets.prices_include_gst = false`).
On the inclusive branch, derive the tax by SUBTRACTION, never by rounding
both base and tax independently — that produces a total off by a paise and a
GST return that will not reconcile.

## Multipliers do not apply to everything

Base amount takes: category uplift × emergency × surge × night × weekend.
Addons and travel take NONE of them.
Overlapping festival multipliers take MAX(), never the product.

## Display

Format only at the UI edge, via `formatINR()` from @clickco/utils. Indian
grouping: ₹1,20,000 not ₹120,000.

## Ledger

Double-entry, append-only. Every transaction balances within its txn_id or the
deferred constraint trigger rejects it. Balances are derived by query, never
stored in a column.

## Two different 15-minute windows (SPEC-AUDIT SA-05) — never merge them

- `extension_rates.waiting_grace_minutes` (15): client not ready, waiting-time billing starts after it.
- No-show trigger: photographer not CHECKED_IN by scheduled_start + 15 min. Operational, not a price.
