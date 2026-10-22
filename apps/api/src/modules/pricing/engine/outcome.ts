import type { PricingResult, Quote, RejectionCode } from './types';

/** Any non-quote result: REJECTED or QUOTE_ONLY. Both stop the pipeline early. */
export type EarlyResult = Exclude<PricingResult, Quote>;

/** Internal step result. A step either yields a value or stops the pipeline with a result. */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly result: EarlyResult };

export const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

export const stop = (result: EarlyResult): Outcome<never> => ({ ok: false, result });

export const reject = (code: RejectionCode, message: string): Outcome<never> =>
  stop({ kind: 'REJECTED', code, message });

/** First failure wins (in input order); otherwise all values, in order. */
export function collect<T>(outcomes: readonly Outcome<T>[]): Outcome<readonly T[]> {
  const failure = outcomes.find((o) => !o.ok);
  if (failure !== undefined && !failure.ok) return failure;
  return ok(outcomes.flatMap((o) => (o.ok ? [o.value] : [])));
}
