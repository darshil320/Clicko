# ADR-0007 — Money at the API boundary (closes SPEC-AUDIT SA-03)

**Status:** Accepted

- **Database:** `bigint` paise. Unchanged.
- **Arithmetic in TypeScript:** `bigint` only (`roundHalfUp`, `ceilHalf` in `@clickco/utils`).
- **Single amounts on the wire:** `MoneyPaise = z.number().int().safe().nonnegative().max(MAX_MONEY_PAISE)` where `MAX_MONEY_PAISE = 100_000_000_000` (₹100 crore). Five orders of magnitude below 2^53, and far above any single booking, invoice or payout. Signed variant `SignedMoneyPaise` for ledger deltas and discount lines.
- **Aggregates on the wire** (ledger sums, payout batch totals, revenue reports): `MoneyPaiseString` — a decimal string of an integer, parsed to `bigint`. Aggregates never travel as JS numbers.

Rationale: keeps the ergonomic `number` for the 99% case while making overflow impossible to reach silently, which is what SA-03 actually asked for.
