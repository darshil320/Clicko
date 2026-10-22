/**
 * Public surface of the pricing engine. Everything here is pure.
 *   computeQuote          — doc 05 §3, the 12-step algorithm
 *   resolveEmergencyBand  — doc 05 §3 step 6 (exclusive upper bounds)
 *   priceExtension        — doc 05 §5 extension_rates (base × uplift only)
 *   toBreakdownJson       — doc 05 §7 snapshot breakdown (JSON-safe numbers)
 */

export { toBreakdownJson } from './breakdown';
export { computeQuote, priceExtension, resolveEmergencyBand } from './compute-quote';
export * from './launch-ruleset';
export * from './types';
